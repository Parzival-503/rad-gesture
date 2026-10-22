#!/usr/bin/env python3
"""
Static structural checker for helper/RadGestureHelper.ahk (AutoHotkey v1.1).

Copied from rad-stopwatch's tools/ahk_check.py (the accumulated memory of AHK
bugs that reached Sina) via rad-proofread, and adapted. Helper-specific
additions are at the bottom: no secrets, no SendMessage, no-focus windows, Hotkey targets,
pure ASCII.

Catches the classes of bugs that bite this project before it ever reaches
Ahk2Exe / a live Windows run:

  1. Every `SetTimer, Target[, ...]` target resolves to a label or function.
  2. Every `Menu, ..., Add, Name, gLabel` handler resolves to a label or function,
     and every `:SubMenu` reference names a menu built EARLIER in the file.
  3. No duplicate labels.
  4. Brace balance (open == close), ignoring braces inside strings/comments.
  5. Quote-escaping inside a(f, "...") / <obj>.Write("...") string literals:
     AHK v1.1 expressions escape a literal double-quote as "" (doubled),
     NOT \" (backslash). A stray \" silently terminates the string early.

Exit code 0 = clean, 1 = problems found.

Usage: python3 tools/ahk_check.py [helper/RadGestureHelper.ahk]
"""
import re
import sys

def load(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read().splitlines()

# ---- Line classification helpers ------------------------------------------

def strip_line_comment(line):
    """Remove a trailing ` ; comment` and full-line `; comment`.
    Honors the AHK rule that a `;` only starts a comment at start-of-line or
    when preceded by whitespace, and not inside a string. This is a heuristic
    good enough for structural checking."""
    in_str = False
    i = 0
    n = len(line)
    out = []
    while i < n:
        c = line[i]
        if c == '"':
            # doubled quote inside string => literal, consume both
            if in_str and i + 1 < n and line[i + 1] == '"':
                out.append('""')
                i += 2
                continue
            in_str = not in_str
            out.append(c)
            i += 1
            continue
        if c == ';' and not in_str:
            prev = line[i - 1] if i > 0 else ' '
            if i == 0 or prev in ' \t':
                break
        out.append(c)
        i += 1
    return ''.join(out)

# ---- Label / function collection ------------------------------------------

LABEL_RE = re.compile(r'^\s*([A-Za-z0-9_@#$?\[\]]+):\s*$')
FUNC_RE = re.compile(r'^\s*([A-Za-z0-9_]+)\s*\(')

def collect_labels_and_funcs(lines):
    labels = {}          # name(lower) -> line number
    dup_labels = []
    funcs = set()
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        code = strip_line_comment(raw)
        m = LABEL_RE.match(code)
        if m:
            name = m.group(1)
            # exclude things that look like hotkeys (contain modifiers) — still a label though
            key = name.lower()
            if key in labels:
                dup_labels.append((name, labels[key], idx))
            else:
                labels[key] = idx
            continue
        mf = FUNC_RE.match(code)
        if mf:
            # crude: a function definition line usually ends with `{` or the
            # next non-empty line is `{`. Accept as a candidate function name.
            funcs.add(mf.group(1).lower())
    return labels, dup_labels, funcs

# AHK built-in Menu handler / timer specials that are not user labels
TIMER_SPECIALS = {'on', 'off', 'delete'}

def check_settimer(lines, labels, funcs):
    problems = []
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        code = strip_line_comment(raw)
        m = re.match(r'^\s*SetTimer\s*,?\s*([^,]+)', code, re.IGNORECASE)
        if not m:
            continue
        target = m.group(1).strip()
        if not target or target.lower() in TIMER_SPECIALS:
            continue
        # dynamic target (contains %var% or expression) — skip, can't resolve
        if '%' in target or target.startswith('"'):
            continue
        key = target.lower()
        if key not in labels and key not in funcs:
            problems.append((idx, target, raw.strip()))
    return problems

def check_menu(lines, labels, funcs):
    problems = []
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        code = strip_line_comment(raw)
        # Menu, MenuName, Add, ItemName, LabelOrFunc [, options]
        m = re.match(r'^\s*Menu\s*,\s*[^,]+,\s*Add\s*,\s*(.*)$', code, re.IGNORECASE)
        if not m:
            continue
        rest = m.group(1)
        # rest = ItemName, Handler [, ...] ; ItemName may contain nothing tricky
        parts = split_top_commas(rest)
        if len(parts) < 2:
            continue  # separator line (Menu, X, Add) with no handler
        handler = parts[1].strip()
        if not handler or handler == '':
            continue
        if '%' in handler or handler.startswith('"'):
            continue
        # submenu references (:SubMenuName) are valid
        if handler.startswith(':'):
            continue
        key = handler.lower()
        if key not in labels and key not in funcs:
            problems.append((idx, handler, raw.strip()))
    return problems

def check_submenus(lines):
    """`Menu, Parent, Add, Text, :Sub` needs Sub to ALREADY exist, so the
    referenced menu must have been built by an earlier `Menu, Sub, Add ...`.
    A typo, or a submenu attached before it is populated, is a load-time
    "Menu does not exist" - which the handler check waves through because a
    `:Name` target is not a label."""
    problems = []
    created = set()
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        code = strip_line_comment(raw)
        m = re.match(r'^\s*Menu\s*,\s*([^,]+),\s*Add\s*,?\s*(.*)$', code, re.IGNORECASE)
        if not m:
            continue
        parent = m.group(1).strip().lower()
        parts = split_top_commas(m.group(2))
        handler = parts[1].strip() if len(parts) >= 2 else ''
        if handler.startswith(':'):
            sub = handler[1:].strip().lower()
            # A submenu built inside a loop/function still shows up as a
            # `Menu, Sub, Add` line, so ordering is all that is checked.
            if sub and '%' not in sub and sub not in created:
                problems.append((idx, handler, raw.strip()))
        created.add(parent)
    return problems


def split_top_commas(s):
    """Split on commas not preceded by an escape backtick and not inside quotes."""
    out = []
    cur = []
    in_str = False
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == '"':
            in_str = not in_str
            cur.append(c)
        elif c == '`' and i + 1 < n:
            cur.append(c); cur.append(s[i+1]); i += 2; continue
        elif c == ',' and not in_str:
            out.append(''.join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    out.append(''.join(cur))
    return out

def brace_delta(code):
    """{ minus } on one (comment-stripped) line, ignoring braces inside
    "strings". The upstream checker counted raw characters, so a function
    containing "{" (ExtractJsonObject here) swallowed the rest of the file."""
    d, in_str, i, n = 0, False, 0, len(code)
    while i < n:
        c = code[i]
        if c == '"':
            if in_str and i + 1 < n and code[i + 1] == '"':
                i += 2; continue
            in_str = not in_str
        elif not in_str and c == '`' and i + 1 < n:
            i += 2; continue
        elif not in_str and c == '{':
            d += 1
        elif not in_str and c == '}':
            d -= 1
        i += 1
    return d


def function_bodies(lines):
    """Yield (def_line_no, name, params, [(line_no, text), ...])."""
    i, n = 0, len(lines)
    while i < n:
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{\s*$', lines[i])
        if not m:
            i += 1
            continue
        depth, body, j = 1, [], i + 1
        while j < n and depth > 0:
            depth += brace_delta(strip_line_comment(lines[j]))
            if depth > 0:
                body.append((j + 1, lines[j]))
            j += 1
        yield i + 1, m.group(1), m.group(2), body
        i = j


def check_braces(lines):
    depth = 0
    in_block_comment = False
    detail = []
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        code = strip_line_comment(raw)
        # walk chars honoring strings (with "" escaping)
        in_str = False
        i = 0
        n = len(code)
        while i < n:
            c = code[i]
            if c == '"':
                if in_str and i + 1 < n and code[i+1] == '"':
                    i += 2; continue
                in_str = not in_str
            elif not in_str and c == '`' and i + 1 < n:
                i += 2; continue
            elif not in_str and c == '{':
                depth += 1
            elif not in_str and c == '}':
                depth -= 1
                if depth < 0:
                    detail.append((idx, 'unbalanced } (depth<0)', raw.strip()))
                    depth = 0
            i += 1
    return depth, detail

def check_quote_escaping(lines):
    """Find a(f, "...") and <obj>.Write("...") calls whose string literal
    contains a backslash-escaped quote \" which is invalid in AHK expressions.
    We walk the string honoring "" doubling; a lone backslash immediately
    followed by a quote that terminates the string is the smell."""
    problems = []
    call_re = re.compile(r'\b(?:a\s*\(\s*f\s*,|\w+\.Write\s*\()', re.IGNORECASE)
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        if not call_re.search(raw):
            continue
        # find first opening quote after the call
        code = raw
        for mm in call_re.finditer(code):
            start = code.find('"', mm.end())
            if start == -1:
                continue
            i = start + 1
            n = len(code)
            while i < n:
                c = code[i]
                if c == '"':
                    if i + 1 < n and code[i+1] == '"':
                        i += 2; continue
                    break  # string end
                if c == '\\' and i + 1 < n and code[i+1] == '"':
                    # backslash directly before a quote inside AHK string literal
                    problems.append((idx, raw.strip()))
                    break
                i += 1
    return problems

FORCED_EXPR_RE = re.compile(r'[A-Za-z0-9_]+:%\s')

def check_forced_expr(lines):
    """AHK v1: a forced-expression parameter must START with '% '.

    Writing `GuiControl, Main:% "+c" . x, Ctl` puts the Gui-name prefix before
    the percent, so AHK parses it in literal mode and dies with
    "This parameter contains a variable name missing its ending percent sign"
    -- at load time, i.e. only on Windows. Cheap to catch here.

    Matches the exact signature (identifier, colon, percent, space); a normal
    %var% deref never looks like this, so false positives are essentially nil.
    """
    problems = []
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        if stripped.startswith(';'):
            continue
        code = strip_line_comment(raw)
        if FORCED_EXPR_RE.search(code):
            problems.append((idx, raw.strip()))
    return problems

COMMAND_LINE_RE = re.compile(r'^\s*[A-Za-z][A-Za-z0-9_]*\s*,')
DEREF_RE = re.compile(r'%[A-Za-z_#@$][A-Za-z0-9_#@$]*%')

def check_literal_percent(lines):
    """AHK v1: in a command's plain-text parameters, % starts a variable.

    `Run, chrome.exe "https://...sourcedoc=%7Ba9...%7D"` (a URL-encoded brace)
    reads "7Ba9...-" as a variable name and dies at load with "variable name
    contains an illegal character" -- the Rad Optimizer script shipped this.
    A literal percent must be written `% . Flags any % left over in a command
    line after escaped `%, %var% derefs and forced-expression parameters
    (", % ...") are taken out.
    """
    problems = []
    in_block_comment = False
    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith('/*'):
            in_block_comment = True
        if in_block_comment:
            if '*/' in stripped:
                in_block_comment = False
            continue
        if stripped.startswith(';'):
            continue
        code = strip_line_comment(raw)
        if not COMMAND_LINE_RE.match(code) or re.search(r'[:.+\-*/]=', code):
            continue
        rest = code.replace('`%', '')
        rest = re.sub(r',\s*%\s.*$', '', rest)   # forced expression to the end
        rest = DEREF_RE.sub('', rest)
        if '%' in rest:
            problems.append((idx, raw.strip()[:90]))
    return problems

IDENT_RE = re.compile(r'\b[A-Za-z_][A-Za-z0-9_]*\b')

def check_undeclared_globals(lines):
    """AHK v1 functions treat any undeclared variable as LOCAL.

    So a function that reads a script global without a matching `global` line
    silently sees an empty string -- no error, just wrong behaviour at runtime.

    Adapted for RadProofread: `global NAME := ...` at script level makes NAME
    a SUPER-global, visible in every function, so those are fine. Only plain
    top-level assignments (`NAME := ...` outside any function) are tracked.
    Functions using bare `global` (assume-global mode) are skipped.
    """
    in_func = set()
    for _, _, _, body in function_bodies(lines):
        in_func.update(ln for ln, _ in body)
    globals_ = set()
    for idx, raw in enumerate(lines, 1):
        if idx in in_func:
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*:=', raw)
        if m:
            globals_.add(m.group(1))

    problems, mixed = [], []
    for defln, fname, params, body in function_bodies(lines):
        declared = set()
        for p in params.split(','):
            p = p.strip().split(':=')[0].strip()
            p = re.sub(r'^(?:ByRef\s+|&)', '', p, flags=re.IGNORECASE)
            if p:
                declared.add(p)
        assume_global = False
        explicit_global_lines = []
        for _, b in body:
            st = strip_line_comment(b).strip()
            if re.match(r'^global\s*$', st):
                assume_global = True
            gm = re.match(r'^global\s+(.+)$', st)
            if gm and ':=' not in gm.group(1):
                explicit_global_lines.append(st)
                for nm in gm.group(1).split(','):
                    declared.add(nm.strip())
        if assume_global and explicit_global_lines:
            mixed.append((defln, fname, explicit_global_lines))
        if not assume_global:
            used = set()
            for _, b in body:
                code = strip_line_comment(b)
                if re.match(r'^\s*global\b', code):
                    continue
                code = re.sub(r'"(?:[^"]|"")*"', '""', code)
                used.update(IDENT_RE.findall(code))
            missing = sorted((used & globals_) - declared)
            if missing:
                problems.append((defln, fname, missing))
    return problems, mixed

GUI_VNAME_RE = re.compile(r'^\s*Gui\s*,[^,]*Add\s*,[^,]*,\s*(.*)$', re.IGNORECASE)


def check_gui_control_vars(lines):
    """`Gui, Add, <Type>, v<Name> ...` inside a function is a LOAD-TIME error
    unless <Name> resolves to a global or static variable:

        Error:  A control's variable must be global or static.
        Specifically: vWellAccent

    A function that adds controls therefore has to be assume-global (a bare
    `global`), which is what BuildGUI() does. BuildWellnessCard() declared
    specific globals instead - enough for the theme constants it read, but the
    v-names were still function-locals, so the card built empty and every entry
    point into it died. This shipped.

    Controls added at script level (labels, the auto-execute section) are fine
    and are not scanned.
    """
    problems = []
    for _, fname, _, body in function_bodies(lines):
        assume_global = False
        declared = set()
        for _, b in body:
            st = strip_line_comment(b).strip()
            if re.match(r'^global\s*$', st):
                assume_global = True
            gm = re.match(r'^(?:global|static)\s+(.+)$', st)
            if gm:
                for nm in gm.group(1).split(','):
                    declared.add(nm.split(':=')[0].strip())
        if not assume_global:
            for ln, b in body:
                gm = GUI_VNAME_RE.match(strip_line_comment(b))
                if not gm:
                    continue
                vm = re.search(r'\bv([A-Za-z_][A-Za-z0-9_]*)', gm.group(1))
                if vm and vm.group(1) not in declared:
                    problems.append((ln, fname, 'v' + vm.group(1), b.strip()[:70]))
    return problems


HOTKEY_DEF_RE = re.compile(r'^(?:#If\b|#IfWin\w*\b|[^\s;][^\n]*::)')

def check_autoexec_truncated(lines):
    """AHK v1's auto-execute section ends at the FIRST hotkey/hotstring
    definition, not at the first `return`.

    So a hotkey placed above the startup code silently kills everything after
    it: the script loads and the hotkeys work, but BuildGUI() never runs and no
    window ever appears. (This exact mistake shipped once - the par wheel
    hotkeys were inserted above BuildGUI().)

    Flags a top-level hotkey/#If that appears before the auto-execute `return`
    while executable startup code still follows it.
    """
    autoexec_end = None
    for idx, raw in enumerate(lines):
        if raw == 'return':
            autoexec_end = idx
            break
    if autoexec_end is None:
        return []

    first_hk = None
    for idx in range(autoexec_end):
        raw = lines[idx]
        if not raw.strip() or raw.lstrip().startswith(';'):
            continue
        if HOTKEY_DEF_RE.match(raw):
            first_hk = idx
            break
    if first_hk is None:
        return []

    stranded = []
    for idx in range(first_hk + 1, autoexec_end):
        raw = lines[idx]
        st = raw.strip()
        if not st or st.startswith(';') or st.startswith('#If') or '::' in st:
            continue
        stranded.append((idx + 1, st[:70]))
    if not stranded:
        return []
    return [(first_hk + 1, lines[first_hk].strip()[:60], stranded)]

# ---- RadProofread-specific checks ------------------------------------------

KEYISH_RE = re.compile(r'"[^"]*(?:sk-ant-[A-Za-z0-9]+-[A-Za-z0-9_\-]{8,}|[A-Za-z0-9_\-]{40,})[^"]*"')
# A real key anywhere on the line, comments included: the prefix, its kind
# (api03, oat01...) and a long tail. The bare prefixes the key cleaner checks
# for ("sk-ant-", "sk-ant-api") are not keys.
REAL_KEY_RE = re.compile(r'sk-ant-[A-Za-z0-9]+-[A-Za-z0-9_\-]{8,}')

def check_secrets(lines):
    """The API key lives in RadProofread.ini (gitignored), never in the
    script. Flags anything shaped like a real key (sk-ant-<kind>-<long tail>),
    any 40+ char token-looking string, and
    g_ApiKey being assigned a non-empty literal."""
    problems = []
    for idx, raw in enumerate(lines, 1):
        code = strip_line_comment(raw)
        if KEYISH_RE.search(code) or REAL_KEY_RE.search(raw):
            problems.append((idx, raw.strip()[:80]))
        elif re.search(r'\bg_ApiKey\s*:=\s*"[^"]+"', code):
            problems.append((idx, raw.strip()[:80]))
    return problems


# Read-only list questions that need an answer, so they can't be PostMessage.
SENDMESSAGE_READ_ONLY = ('LB_FINDSTRINGEXACT', 'LB_GETCOUNT', 'LB_GETCURSEL', 'LB_GETITEMRECT')

def check_no_sendmessage(lines):
    """PowerScribe rules, learned the hard way: a SendMessage that CHANGES
    something there gave RPC_E_CANTCALLOUT_ININPUTSYNCCALL (use PostMessage),
    and raw EM_* messages to the report editor crash it.

    Allowed: DllCall SendMessage for the four read-only pick-list questions in
    SENDMESSAGE_READ_ONLY (Lung-RADS has used exactly these daily). The whole
    statement is read, including `, ...` continuation lines, and must name one
    of them. The SendMessage command and EM_* are never allowed."""
    problems = []
    n = len(lines)
    for idx, raw in enumerate(lines, 1):
        code = strip_line_comment(raw)
        if re.match(r'^\s*SendMessage\b', code, re.IGNORECASE) or re.search(r'\bEM_[A-Z]+\b', code):
            problems.append((idx, raw.strip()[:80]))
            continue
        if not re.search(r'DllCall\(\s*"(?:user32\\)?SendMessage', code, re.IGNORECASE):
            continue
        stmt = code
        j = idx  # 0-based index of the next line
        while j < n and re.match(r'^\s*,', lines[j]):
            stmt += ' ' + strip_line_comment(lines[j])
            j += 1
        if not any(re.search(r'\b%s\b' % q, stmt) for q in SENDMESSAGE_READ_ONLY):
            problems.append((idx, raw.strip()[:80]))
    return problems


# Windows that must never take focus (they appear during dictation).
NOACTIVATE_GUIS = {'PriorBin', 'PriorList', 'Impression', 'Toast'}

def check_noactivate(lines):
    """Every window in NOACTIVATE_GUIS must be created with +E0x08000000
    (WS_EX_NOACTIVATE), and every `Gui, Name:Show` of such a window must say
    NoActivate. A window that steals focus mid-dictation sends speech and
    keystrokes into the wrong place."""
    problems = []
    has_style = set()
    shows = []
    for idx, raw in enumerate(lines, 1):
        code = strip_line_comment(raw)
        m = re.match(r'^\s*Gui\s*,\s*([A-Za-z0-9_]+):(.*)$', code, re.IGNORECASE)
        if not m:
            continue
        name, rest = m.group(1), m.group(2)
        if re.search(r'(?i)\+E0x08000000', rest):
            has_style.add(name)
        if re.match(r'(?i)\s*Show\b', rest):
            shows.append((idx, name, rest))
    for name in sorted(NOACTIVATE_GUIS - has_style):
        problems.append((0, f"{name}: never given +E0x08000000"))
    for idx, name, rest in shows:
        if (name in NOACTIVATE_GUIS or name in has_style) and not re.search(r'(?i)\bNoActivate\b', rest):
            problems.append((idx, f"{name}:Show without NoActivate"))
    return problems


NO_MSGBOX_FUNC_RE = re.compile(r'^(?:Prior|ShowPrior|UpdatePrior|PostClaude|ReadExamTitle|Impression|ShowImpression|Trigger_OneLiner|RunFlavor|Toast|KillToast|PanicTeardown|Hub|RunHubAction|MigrateOldSettings)')

def check_no_msgbox_in_prior_mode(lines):
    """Prior checklist, impression and one-liner run mid-workflow: a MsgBox
    grabs focus. They report through Notify(), Toast() or their own window."""
    problems = []
    for _, fname, _, body in function_bodies(lines):
        if not NO_MSGBOX_FUNC_RE.match(fname):
            continue
        for ln, b in body:
            if re.match(r'^\s*MsgBox\b', strip_line_comment(b), re.IGNORECASE):
                problems.append((ln, fname, b.strip()[:70]))
    return problems


def check_hotkey_targets(lines, labels, funcs):
    """`Hotkey, KeyName, Target` - Target must be a real label/function, or
    the bind fails at runtime (inside a try, so silently)."""
    problems = []
    for idx, raw in enumerate(lines, 1):
        code = strip_line_comment(raw)
        m = re.match(r'^\s*(?:try\s+)?Hotkey\s*,\s*(.*)$', code, re.IGNORECASE)
        if not m:
            continue
        parts = split_top_commas(m.group(1))
        if len(parts) < 2:
            continue
        target = parts[1].strip()
        if not target or target.lower() in ('on', 'off', 'toggle', 'alttab') or '%' in target:
            continue
        if target.lower() not in labels and target.lower() not in funcs:
            problems.append((idx, target, raw.strip()[:70]))
    return problems


def check_ascii(lines):
    """Keep the .ahk pure ASCII: AHK v1 reads a BOM-less file as ANSI, so a
    stray curly quote or dash turns into mojibake in prompts and UI."""
    return [(idx, raw.strip()[:70]) for idx, raw in enumerate(lines, 1)
            if any(ord(ch) > 127 for ch in raw)]


def report(ok_flag, items, title, fmt, okmsg):
    if items:
        print(f"\n[FAIL] {title} ({len(items)}):")
        for it in items:
            print("  " + fmt(it))
        return False
    print(f"[ok] {okmsg}")
    return ok_flag


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'helper/RadGestureHelper.ahk'
    lines = load(path)
    labels, dup_labels, funcs = collect_labels_and_funcs(lines)

    ok = True
    print(f"[ahk_check] {path}: {len(lines)} lines, "
          f"{len(labels)} labels, {len(funcs)} function candidates")

    st = check_settimer(lines, labels, funcs)
    if st:
        ok = False
        print(f"\n[FAIL] SetTimer targets with no matching label/function ({len(st)}):")
        for ln, tgt, src in st:
            print(f"  L{ln}: target '{tgt}'  |  {src}")
    else:
        print("[ok] all SetTimer targets resolve")

    mn = check_menu(lines, labels, funcs)
    if mn:
        ok = False
        print(f"\n[FAIL] Menu Add handlers with no matching label/function ({len(mn)}):")
        for ln, h, src in mn:
            print(f"  L{ln}: handler '{h}'  |  {src}")
    else:
        print("[ok] all Menu Add handlers resolve")

    sm = check_submenus(lines)
    if sm:
        ok = False
        print(f"\n[FAIL] submenu attached before it exists ({len(sm)}):")
        for ln, h, src in sm:
            print(f"  L{ln}: '{h}' has no earlier `Menu, ..., Add`  |  {src}")
    else:
        print("[ok] all submenu references exist before use")

    gv = check_gui_control_vars(lines)
    if gv:
        ok = False
        print(f"\n[FAIL] Gui control v-names not global/static ({len(gv)}):")
        for ln, fn, v, src in gv:
            print(f"  L{ln}: {v} in {fn}() - needs a bare `global`  |  {src}")
    else:
        print("[ok] all Gui control v-names are global or static")

    if dup_labels:
        ok = False
        print(f"\n[FAIL] duplicate labels ({len(dup_labels)}):")
        for name, first, second in dup_labels:
            print(f"  '{name}' at L{first} and L{second}")
    else:
        print("[ok] no duplicate labels")

    depth, detail = check_braces(lines)
    if depth != 0 or detail:
        ok = False
        print(f"\n[FAIL] brace imbalance: final depth {depth}")
        for ln, msg, src in detail[:20]:
            print(f"  L{ln}: {msg}  |  {src}")
    else:
        print("[ok] braces balanced")

    ug, mixedg = check_undeclared_globals(lines)
    if ug:
        print(f"\n[warn] functions using a script global without declaring it ({len(ug)}):")
        for ln, fn, names in ug:
            print(f"  L{ln} {fn}(): {', '.join(names)}")
        print("  (AHK v1 treats these as empty LOCALS - silent wrong behaviour)")
    else:
        print("[ok] no undeclared global usage in functions")

    if mixedg:
        ok = False
        print(f"\n[FAIL] `global X` declared inside an assume-global function ({len(mixedg)}):")
        for ln, fn, decls in mixedg:
            print(f"  {fn}() at L{ln}: {decls}")
        print("  AHK v1: a function with a bare `global` cannot also declare"
              " specific globals -> load-time error")
    else:
        print("[ok] no global decls inside assume-global functions")

    ax = check_autoexec_truncated(lines)
    if ax:
        ok = False
        for ln, hk, stranded in ax:
            print(f"\n[FAIL] hotkey at L{ln} truncates the auto-execute section: {hk}")
            print(f"  {len(stranded)} startup line(s) after it never run, e.g.:")
            for sl, txt in stranded[:6]:
                print(f"    L{sl}: {txt}")
            print("  fix: move hotkey/#If definitions BELOW the auto-execute `return`")
    else:
        print("[ok] auto-execute section not truncated by a hotkey")

    fe = check_forced_expr(lines)
    if fe:
        ok = False
        print(f"\n[FAIL] forced-expression '%' not at start of parameter ({len(fe)}):")
        for ln, src in fe:
            print(f"  L{ln}: {src}")
        print("  fix: build the whole option into a variable first, then"
              " `GuiControl, % opt, Ctl`")
    else:
        print("[ok] no misplaced forced-expression parameters")

    qe = check_quote_escaping(lines)
    if qe:
        ok = False
        print(f"\n[FAIL] backslash-escaped quotes in a()/Write() strings ({len(qe)}):")
        for ln, src in qe:
            print(f"  L{ln}: {src}")
    else:
        print("[ok] no backslash-escaped quotes in a()/Write() strings")

    ok = report(ok, check_secrets(lines), "possible API key / secret in the script",
                lambda t: f"L{t[0]}: {t[1]}", "no secrets in the script")
    ok = report(ok, check_no_sendmessage(lines), "SendMessage that is not a read-only list query, or raw EM_* (PowerScribe crash risk)",
                lambda t: f"L{t[0]}: {t[1]}", "SendMessage only for read-only list queries; no editor messages")
    ok = report(ok, check_noactivate(lines), "window that could steal focus",
                lambda t: (f"L{t[0]}: " if t[0] else "") + t[1], "no-focus windows are NOACTIVATE everywhere")
    ok = report(ok, check_no_msgbox_in_prior_mode(lines), "MsgBox in a mid-workflow mode (prior checklist, impression, one-liner)",
                lambda t: f"L{t[0]} {t[1]}(): {t[2]}", "no MsgBox in mid-workflow modes")
    ok = report(ok, check_hotkey_targets(lines, labels, funcs), "Hotkey targets with no label/function",
                lambda t: f"L{t[0]}: '{t[1]}'  |  {t[2]}", "all Hotkey targets resolve")
    lp = check_literal_percent(lines)
    ok = report(ok, lp, "literal % in a command (starts a variable; write `%)",
                lambda it: f"L{it[0]}: {it[1]}", "no stray % in command parameters")
    ok = report(ok, check_ascii(lines), "non-ASCII characters",
                lambda t: f"L{t[0]}: {t[1]}", "file is pure ASCII")

    print("\n" + ("PASS" if ok else "PROBLEMS FOUND"))
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
