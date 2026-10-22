#!/usr/bin/env python3
"""
Shortcut audit for everything that runs on the reading workstation.

Collects every hotkey from:
  - the RadGesture helper (its INI defaults: proofread, one-liner, Lung-RADS,
    the ring trigger, and the optional blank ones),
  - the helper's Library (config/library.json: Rad Optimizer's functions,
    their default keyboard shortcuts and the keys they press into apps),
  - RadStopwatch (../rad-stopwatch/RadStopwatch.ahk if checked out, else the
    saved copy in tools/external_hotkeys.json),
  - scripts that are not in any repo (Rad Optimizer), from that JSON file,
and checks:
  1. no two running scripts claim the same key combination,
  2. no running hotkey swallows a key another script presses into an app,
  3. every Ring button that presses keys ("helper:keys:...") lands on a real
     hotkey, and every Library button ("helper:lib:...") names a real
     function, so no button silently does nothing,
  4. no running hotkey takes a combination Windows itself uses,
  5. which old scripts must be closed because they would clash.

Writes docs/shortcuts.md (the shortcut inventory) and exits 1 on any clash.
Usage: python3 tools/hotkey_audit.py [--check]   (--check: don't rewrite the doc)
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MOD_ORDER = '^!+#'
MOD_NAME = {'^': 'Ctrl', '!': 'Alt', '+': 'Shift', '#': 'Win'}
WINDOWS_RESERVED = {'^!delete', '!tab', '!f4', '^esc', '^+esc', '#l', '#d', '#e', '#r', '#tab', '^!tab'}


def parse_key(spec):
    """'~^!F4' -> dict(mods='^!', key='f4', up=False, passthrough=True, wildcard=False)."""
    s = spec.strip()
    flags = {'passthrough': False, 'wildcard': False}
    while s and s[0] in '~*$':
        if s[0] == '~':
            flags['passthrough'] = True
        if s[0] == '*':
            flags['wildcard'] = True
        s = s[1:]
    mods = set()
    while len(s) > 1 and s[0] in '^!+#<>':
        if s[0] in MOD_ORDER:
            mods.add(s[0])
        s = s[1:]
    up = False
    if s.lower().endswith(' up'):
        up = True
        s = s[:-3]
    key = s.strip().strip('{}').lower()
    return dict(mods=''.join(m for m in MOD_ORDER if m in mods), key=key, up=up, **flags)


def parse_send(keys):
    """AHK Send syntax for one combination: '^!2', '{F4}', '+{Tab}'."""
    m = re.match(r'^([\^!+#]*)(\{[^}]+\}|.)$', keys.strip())
    if not m:
        return None
    return dict(mods=''.join(c for c in MOD_ORDER if c in m.group(1)), key=m.group(2).strip('{}').lower(), up=False)


def combo(k):
    return (k['mods'], k['key'], k['up'])


KEY_NAME = {'wheelup': 'WheelUp', 'wheeldown': 'WheelDown', 'capslock': 'CapsLock', 'esc': 'Esc',
            'tab': 'Tab', 'end': 'End', 'enter': 'Enter', 'space': 'Space'}


def pretty(k):
    key = KEY_NAME.get(k['key']) or (k['key'].upper() if len(k['key']) == 1 or re.match(r'^f\d+$', k['key']) else k['key'].capitalize())
    s = '+'.join([MOD_NAME[m] for m in k['mods']] + [key])
    return s + (' (release)' if k['up'] else '')


def ahk_hotkeys(path, script):
    """`key::` definitions, with #If context noted."""
    out, context = [], None
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.split(' ;')[0].rstrip()
        if line.lstrip().startswith(';'):
            continue
        m = re.match(r'^#If\b\s*(.*)$', line.strip())
        if m:
            context = m.group(1) or None
            continue
        m = re.match(r'^([^\s:;][^:]*?)::', line)
        if m and not line.startswith(':'):
            k = parse_key(m.group(1))
            out.append(dict(script=script, spec=m.group(1), does='', context=context, **k))
    return out


def helper_hotkeys(path):
    """The helper binds everything with the Hotkey command from INI values;
    the IniRead defaults are what a fresh install uses."""
    src = open(path, encoding='utf-8').read()
    names = {
        ('Behavior', 'Hotkey'): 'Proofread',
        ('OneLiner', 'Hotkey'): 'One-liner',
        ('Impression', 'Hotkey'): 'Impression',
        ('Priors', 'AddHotkey'): 'Add prior',
        ('Priors', 'ChecklistHotkey'): 'Prior checklist',
        ('LungRADS', 'Hotkey'): 'Lung-RADS',
        ('Hub', 'Trigger'): 'Open the ring (hold)',
    }
    out = []
    for sec, key, default in re.findall(r'IniRead, v, %INI_PATH%, (\w+), (\w*Hotkey|Trigger), (.+)', src):
        default = default.strip()
        if (sec, key) not in names or default == '%A_Space%':
            continue
        k = parse_key(default)
        out.append(dict(script='RadGesture helper', spec=default, does=names[(sec, key)], context=None, **k))
        if (sec, key) == ('Hub', 'Trigger'):
            up = parse_key('~*' + k['key'] + ' up')
            out.append(dict(script='RadGesture helper', spec='~*%s up' % k['key'], does='Ring trigger released', context=None, **up))
    esc = parse_key('Esc')
    out.append(dict(script='RadGesture helper', spec='Esc', does='Close the ring', context='only while the ring is open', **esc))
    return out


def library_hotkeys(lib):
    """The Library's keyboard shortcuts that are on by default, and the keys
    its functions press into Sectra / PowerScribe."""
    hot, sends = [], []
    for f in lib['functions']:
        if f.get('on') and f.get('hotkey'):
            k = parse_key(f['hotkey'])
            hot.append(dict(script='RadGesture helper', spec=f['hotkey'], does='Library: ' + f['name'], context=None, **k))
        for prm in f.get('params', []):
            if prm['type'] == 'key' and prm['default'] and (f.get('on') or not f.get('hotkey')):
                k = parse_send(prm['default'])
                if k:
                    sends.append(dict(script='RadGesture helper', **k))
    return hot, sends


def ahk_sends(path, script):
    out = []
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.split(' ;')[0]
        m = re.match(r'^\s*Send(?:Input|Event)?\s*,?\s*(\S+)\s*$', line)
        if m and '%' not in m.group(1):
            for part in re.findall(r'[\^!+#]*(?:\{[^}]+\}|[^\s{])', m.group(1)):
                k = parse_send(part)
                if k and not k['key'].endswith(' up') and k['key'] not in ('ctrl up', 'alt up', 'shift up'):
                    out.append(dict(script=script, **k))
    return out


def main():
    check_only = '--check' in sys.argv
    ext = json.load(open(os.path.join(ROOT, 'tools', 'external_hotkeys.json')))
    menu = json.load(open(os.path.join(ROOT, 'config', 'default-menu.json')))
    helper = os.path.join(ROOT, 'helper', 'RadGestureHelper.ahk')

    lib = json.load(open(os.path.join(ROOT, 'config', 'library.json')))
    lib_ids = {f['id'] for f in lib['functions']}
    running = helper_hotkeys(helper)
    sends = ahk_sends(helper, 'RadGesture helper')
    lib_hot, lib_sends = library_hotkeys(lib)
    running += lib_hot
    sends += lib_sends
    notes = []

    sw = ext['sibling_fallback']
    sw_path = os.path.join(ROOT, sw['file'])
    sw_saved = sorted(combo(parse_key(h['key'])) for h in sw['hotkeys'])
    if os.path.exists(sw_path):
        found = ahk_hotkeys(sw_path, sw['script'])
        running += found
        sends += ahk_sends(sw_path, sw['script'])
        if sorted(combo(h) for h in found) != sw_saved:
            notes.append('RadStopwatch\'s hotkeys changed: update "sibling_fallback" in tools/external_hotkeys.json.')
    else:
        for h in sw['hotkeys']:
            running.append(dict(script=sw['script'], spec=h['key'], does=h['does'], context=h.get('context'), **parse_key(h['key'])))
        notes.append('RadStopwatch not checked out next to this repo: used its saved hotkey list.')

    for s in ext['running']:
        for h in s['hotkeys']:
            running.append(dict(script=s['script'], spec=h['key'], does=h['does'], context=h.get('context'), **parse_key(h['key'])))
            for snd in h.get('sends', []):
                k = parse_send(snd)
                if k:
                    sends.append(dict(script=s['script'], **k))

    shared_ok = {combo(parse_key(x['key'])): x['why'] for x in ext.get('shared_on_purpose', [])}
    problems = []

    # 1. Two running scripts on one combination (a context-only hotkey clashes
    #    only with a global one).
    by = {}
    for h in running:
        by.setdefault(combo(h), []).append(h)
    for c, hs in sorted(by.items()):
        scripts = {h['script'] for h in hs}
        if len(hs) < 2:
            continue
        if all(h['context'] for h in hs) and len(scripts) == 1:
            continue
        if c in shared_ok:
            continue
        if len(scripts) == 1 and len(hs) == 2 and any(h['context'] for h in hs):
            continue
        problems.append('Clash: %s is used by %s' % (pretty(hs[0]), ', '.join('%s (%s)' % (h['script'], h['does'] or h['spec']) for h in hs)))
    # wildcard hotkeys match every modifier combination of their key
    for w in [h for h in running if h['wildcard'] and not h['passthrough']]:
        for h in running:
            if h is not w and h['key'] == w['key'] and h['up'] == w['up'] and h['script'] != w['script']:
                problems.append('Clash: %s (any modifiers) in %s also catches %s in %s' % (w['key'], w['script'], pretty(h), h['script']))

    # 2. A key one script presses into an app, caught by another script's
    #    hotkey that does not pass it through.
    for s in sends:
        for h in by.get(combo(s), []):
            if h['script'] != s['script'] and not h['passthrough'] and not h['context']:
                problems.append('Swallowed: %s presses %s into an app, but %s catches it (%s)' % (s['script'], pretty(s), h['script'], h['does'] or h['spec']))

    # 3. Ring buttons that press keys must land on a running hotkey.
    ring = []
    lib_ring = []
    def walk(items, path):
        for it in items:
            here = path + [it['name']]
            if 'items' in it:
                walk(it['items'], here)
            elif it.get('action', '').startswith('helper:keys:'):
                k = parse_send(it['action'][len('helper:keys:'):])
                targets = by.get(combo(k), []) if k else []
                ring.append((' > '.join(here), pretty(k) if k else it['action'], targets))
                if not targets:
                    problems.append('Ring button "%s" presses %s, which no running script handles' % (' > '.join(here), it['action']))
            elif it.get('action', '').startswith('helper:lib:'):
                lid = it['action'][len('helper:lib:'):]
                lib_ring.append((' > '.join(here), lid))
                if lid not in lib_ids:
                    problems.append('Ring button "%s" runs library function "%s", which does not exist' % (' > '.join(here), lid))
    for c in menu['categories']:
        walk(c['items'], [c['name']])

    # 4. Windows' own combinations.
    for h in running:
        if (h['mods'] + h['key']) in WINDOWS_RESERVED:
            problems.append('Windows uses %s, but %s claims it' % (pretty(h), h['script']))

    # 5. Old scripts that must be closed.
    retire = []
    for s in ext.get('retire', []):
        for h in s['hotkeys']:
            k = parse_key(h['key'])
            hit = [r for r in by.get(combo(k), [])]
            if hit:
                retire.append((s['script'], pretty(k), hit[0]['script'], hit[0]['does'] or hit[0]['spec']))

    # ---- report
    for p in problems:
        print('[FAIL] ' + p)
    for n in notes:
        print('[note] ' + n)
    print('[ok] %d shortcuts across %d scripts; %d ring buttons press keys, %d run library functions' % (
        len(running), len({h['script'] for h in running}), len(ring), len(lib_ring)))
    print('PASS' if not problems else 'PROBLEMS FOUND')

    if not check_only:
        L = ['# Shortcuts on the reading workstation', '',
             'Generated by `python3 tools/hotkey_audit.py`. Do not edit by hand: change the',
             'scripts, `config/library.json` (the Library) or `tools/external_hotkeys.json`', 'and re-run it.', '',
             '**Clashes: %s**' % ('none' if not problems else len(problems)), '']
        for p in problems:
            L.append('- ' + p)
        L += ['', '## Close these before installing RadGesture', '',
              '| Old script | Key | Now belongs to |', '|---|---|---|']
        for old, key, new, does in retire:
            L.append('| %s | %s | %s (%s) |' % (old, key, new, does))
        L += ['', '## Shared on purpose', '']
        for c, why in shared_ok.items():
            L.append('- **%s**: %s' % (pretty(dict(mods=c[0], key=c[1], up=c[2])), why))
        for script in sorted({h['script'] for h in running}):
            L += ['', '## ' + script, '', '| Key | Does |', '|---|---|']
            for h in sorted([h for h in running if h['script'] == script], key=lambda h: (h['mods'], h['key'])):
                extra = ' (%s)' % h['context'] if h['context'] else ''
                pt = ' - key still reaches the app' if h['passthrough'] and not h['up'] else ''
                L.append('| %s | %s%s%s |' % (pretty(h), h['does'] or '', extra, pt))
        L += ['', '## Ring buttons that press keys', '', '| Ring button | Presses | Handled by |', '|---|---|---|']
        for name, key, targets in ring:
            L.append('| %s | %s | %s |' % (name, key, ', '.join('%s: %s' % (t['script'], t['does'] or t['spec']) for t in targets) or '**nothing**'))
        names = {f['id']: f for f in lib['functions']}
        L += ['', '## Ring buttons that run Library functions', '',
              'These run inside RadGesture (Rad Optimizer is not needed). The key is what the function presses inside the program; set it in Settings > Library.', '',
              '| Ring button | Function | Presses |', '|---|---|---|']
        for name, lid in lib_ring:
            f = names.get(lid)
            keys = ', '.join(pretty(parse_send(p['default'])) for p in (f or {}).get('params', []) if p['type'] == 'key' and p['default'] and parse_send(p['default']))
            L.append('| %s | %s | %s |' % (name, f['name'] if f else '**missing: %s**' % lid, keys or '-'))
        L += ['', '## Library functions off by default', '', '| Function | Shortcut when switched on |', '|---|---|']
        for f in lib['functions']:
            if not f.get('on'):
                L.append('| %s | %s |' % (f['name'], pretty(parse_key(f['hotkey'])) if f.get('hotkey') else '(none)'))
        L += ['', '## Free for new tools', '',
              'Not used by any script above (Ctrl+Alt+letter is the family pattern):', '']
        used = {(h['mods'], h['key']) for h in running}
        free = [l for l in 'abcdefghijklmnopqrstuvwxyz' if ('^!', l) not in used]
        L.append(', '.join('Ctrl+Alt+' + l.upper() for l in free))
        L.append('')
        os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
        open(os.path.join(ROOT, 'docs', 'shortcuts.md'), 'w').write('\n'.join(L))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
