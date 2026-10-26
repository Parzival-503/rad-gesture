; SPDX-FileCopyrightText: Avecina Studio
; SPDX-License-Identifier: MIT
;
; RadChecklist - turns a prior radiology report (built for FDG PET/CT) into a
; short, prioritised checklist of things to compare on today's study.
;
; Usage:  copy or select the prior report, then press the build hotkey
;         (Ctrl+Alt+P by default). A small always-on-top window appears with
;         tick boxes. Tick each item as you address it; before you sign, hit
;         "Copy unaddressed" to see what you never mentioned.
;
; Requires AutoHotkey v2. Settings live in RadChecklist.ini next to this file.

#Requires AutoHotkey v2.0
#SingleInstance Force

; ---------------------------------------------------------------------------
; Configuration
; ---------------------------------------------------------------------------

App := {gui: "", boxes: [], summary: "", progress: "", busy: false}

CFG_FILE := A_ScriptDir "\RadChecklist.ini"

Cfg := Map()
Cfg["api_key"]       := IniRead(CFG_FILE, "api", "key", "")
Cfg["base_url"]      := IniRead(CFG_FILE, "api", "base_url", "https://api.anthropic.com/v1/messages")
Cfg["model"]         := IniRead(CFG_FILE, "api", "model", "claude-opus-5")
Cfg["effort"]        := IniRead(CFG_FILE, "api", "effort", "medium")
Cfg["max_tokens"]    := Integer(IniRead(CFG_FILE, "api", "max_tokens", "4000"))
Cfg["scrub_phi"]     := Integer(IniRead(CFG_FILE, "behavior", "scrub_phi", "1"))
Cfg["max_items"]     := Integer(IniRead(CFG_FILE, "behavior", "max_items", "14"))
Cfg["hotkey_build"]  := IniRead(CFG_FILE, "behavior", "hotkey_build", "^!p")
Cfg["hotkey_toggle"] := IniRead(CFG_FILE, "behavior", "hotkey_toggle", "^!o")

; The API key may live in the environment instead of the ini file, which keeps
; it out of any file you might accidentally share or commit.
if (Cfg["api_key"] = "")
    Cfg["api_key"] := EnvGet("ANTHROPIC_API_KEY")

; ---------------------------------------------------------------------------
; Tray + hotkeys
; ---------------------------------------------------------------------------

try TraySetIcon("shell32.dll", 172)
A_IconTip := "RadChecklist"
tray := A_TrayMenu
tray.Delete()
tray.Add("Build checklist from clipboard", (*) => BuildChecklist())
tray.Add("Show/hide checklist", (*) => ToggleChecklist())
tray.Add()
tray.Add("Edit settings", (*) => EditSettings())
tray.Add("Reload", (*) => Reload())
tray.Add("Exit", (*) => ExitApp())
tray.Default := "Build checklist from clipboard"

try Hotkey(Cfg["hotkey_build"], (*) => BuildChecklist())
catch as e
    MsgBox("Could not register the build hotkey '" . Cfg["hotkey_build"] . "'.`n`n" . e.Message, "RadChecklist", "Icon!")

try Hotkey(Cfg["hotkey_toggle"], (*) => ToggleChecklist())
catch as e
    MsgBox("Could not register the toggle hotkey '" . Cfg["hotkey_toggle"] . "'.`n`n" . e.Message, "RadChecklist", "Icon!")

; Hotkeys here are registered dynamically rather than declared, so say plainly
; that the script should stay resident instead of relying on that to imply it.
Persistent()

; ---------------------------------------------------------------------------
; The prompt. This is the part that decides what gets kept and what gets
; dropped, so it is deliberately explicit about both.
; ---------------------------------------------------------------------------

BuildSystemPrompt(maxItems) {
    prompt := "
(
You assist a board-certified radiologist who is reading a FOLLOW-UP FDG PET/CT. You are given the full text of the PRIOR report. Produce a short comparison checklist: the specific things the radiologist must look at on today's study in order to state whether each prior finding has resolved, improved, is stable, or has worsened.

OUTPUT FORMAT. Output nothing but these lines. No preamble, no markdown, no bullet characters, no closing remarks.

SUMMARY|one line, 15 words maximum, describing the prior disease state
TIER|ITEM|PRIOR

TIER is 1, 2 or 3.

1 = Must address. Target and measurable lesions. Anything the prior called new, progressing or worsening. Anything carrying an explicit recommendation or a stated follow-up interval. Any actionable non-oncologic finding: pulmonary embolism, aortic dissection, aneurysm over 5 cm, new or enlarging pulmonary nodule, fracture, bowel obstruction, abscess, hydronephrosis, intracranial finding.
2 = Should address. Other FDG-avid or measurable disease sites. Findings the prior called indeterminate, equivocal or not further characterised.
3 = Mention only if changed. Real but low-yield baseline findings.

ITEM is 8 words maximum: the anatomic site and lesion, nothing else.
PRIOR is 12 words maximum: the prior numbers that make the comparison possible.

RULES

Output at most MAXITEMS items. Fewer is better. A short prior report should produce a short list. Never pad the list to reach the cap.

Order strictly: every tier 1 line first, then tier 2, then tier 3. Within a tier, most clinically consequential first.

One line per anatomic finding. Merge findings in the same organ or nodal station onto one line.

Always carry the prior's own numbers into PRIOR: SUVmax, size in cm, Deauville score, nodal station, series and image number, laterality, and the prior study date when the report gives it. These numbers are the entire point of the line. Never invent, round or estimate a number that is not in the prior text. If the prior gave no number, write the prior descriptor instead.

DROP these entirely, they are noise: hepatic steatosis, uncomplicated diverticulosis, degenerative and spondylotic change, mild or dependent atelectasis, physiologic uptake anywhere including brain, myocardium, bowel, marrow, brown fat and urinary tract, technique and radiotracer dose and blood glucose text, clinical history, indication, comparison list, stable surgical hardware without complication, coronary and aortic calcification, simple renal and hepatic cysts, calcified granulomas, uncomplicated hiatal hernia, and every negative statement such as no acute finding or unremarkable.

Do not include anything the prior explicitly described as resolved or normal, unless it was a target lesion whose site still has to be checked.

Never write compare to prior, correlate clinically, or clinical correlation recommended. Write the concrete thing to look at instead.

Offer no diagnosis and no management advice of your own. This is a look-here list for a physician, not a report and not an interpretation.

If the supplied text is not a radiology report, output only this single line and nothing else:
SUMMARY|Input does not look like a radiology report.
)"

    return StrReplace(prompt, "MAXITEMS", maxItems)
}

; ---------------------------------------------------------------------------
; Main flow
; ---------------------------------------------------------------------------

BuildChecklist() {
    global App, Cfg

    if (App.busy)
        return
    if (Cfg["api_key"] = "") {
        MsgBox("No API key.`n`nSet ANTHROPIC_API_KEY in your environment, or put"
             . " key=... under [api] in RadChecklist.ini next to the script.",
               "RadChecklist", "Icon!")
        return
    }

    report := GetReportText()
    if (StrLen(Trim(report)) < 200) {
        MsgBox("That does not look like a report - only " StrLen(Trim(report))
             . " characters were found.`n`nSelect the prior report, or copy it to"
             . " the clipboard, then press the hotkey again.", "RadChecklist", "Icon!")
        return
    }

    if (Cfg["scrub_phi"])
        report := ScrubPHI(report)

    App.busy := true
    progressGui := ShowProgress()
    raw := ""
    try {
        raw := CallClaude(report, progressGui)
    } catch as e {
        progressGui.Destroy()
        App.busy := false
        MsgBox(e.Message, "RadChecklist - request failed", "Icon!")
        return
    }
    progressGui.Destroy()
    App.busy := false

    parsed := ParseChecklist(raw, Cfg["max_items"])
    if (parsed.items.Length = 0) {
        MsgBox("No checklist items came back.`n`nModel said:`n`n"
             . SubStr(raw, 1, 800), "RadChecklist", "Icon!")
        return
    }
    ShowChecklistGui(parsed.summary, parsed.items)
}

; Prefer whatever is selected; fall back to whatever is already on the
; clipboard. This way it works both for "I highlighted the prior report" and
; for "I already copied it".
GetReportText() {
    ; The build hotkey holds modifiers down; sending ^c while Alt is still
    ; physically pressed produces Ctrl+Alt+C and copies nothing.
    KeyWait("Ctrl", "T0.5")
    KeyWait("Alt", "T0.5")
    KeyWait("Shift", "T0.5")

    saved := ClipboardAll()
    A_Clipboard := ""
    Send("^c")
    got := ClipWait(0.6, 0)
    text := got ? A_Clipboard : ""

    if (StrLen(Trim(text)) < 200) {
        A_Clipboard := saved
        Sleep(60)
        text := A_Clipboard
    } else {
        A_Clipboard := saved
    }
    saved := ""
    return text
}

; Reduces identifiability before the text leaves the machine. This is NOT
; de-identification - study dates and clinical detail are deliberately kept
; because the comparison is useless without them. See the README.
ScrubPHI(text) {
    out := ""
    dropPattern := "i)^\s*(patient|pt|name|patient name|mrn|medical record|record number|"
                 . "acc(ession)?|accession number|dob|date of birth|age\/sex|ssn|"
                 . "ordering (physician|provider)|referring (physician|provider)|"
                 . "attending|resident|fellow|technologist|signed by|"
                 . "electronically signed|dictated by|transcribed by|phone|tel|fax|"
                 . "address|room|bed|encounter|visit number|fin)(\s+by)?\b\s*[:#]"

    for line in StrSplit(text, "`n", "`r") {
        if (RegExMatch(line, dropPattern))
            continue
        ; Any run of 6 or more digits is far more likely to be an identifier
        ; than a measurement.
        line := RegExReplace(line, "\d{6,}", "[ID]")
        out .= line "`n"
    }
    return out
}

; ---------------------------------------------------------------------------
; API call
; ---------------------------------------------------------------------------

CallClaude(report, progressGui) {
    global Cfg

    system := BuildSystemPrompt(Cfg["max_items"])

    body := '{'
          . '"model":"' JsonEscape(Cfg["model"]) '",'
          . '"max_tokens":' Cfg["max_tokens"] ','
          . '"output_config":{"effort":"' JsonEscape(Cfg["effort"]) '"},'
          . '"system":"' JsonEscape(system) '",'
          . '"messages":[{"role":"user","content":"'
          . JsonEscape("PRIOR REPORT:`n`n" report) '"}]'
          . '}'

    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.SetTimeouts(10000, 10000, 30000, 180000)
    req.Open("POST", Cfg["base_url"], true)
    req.SetRequestHeader("content-type", "application/json")
    req.SetRequestHeader("anthropic-version", "2023-06-01")
    req.SetRequestHeader("x-api-key", Cfg["api_key"])
    req.Send(body)

    start := A_TickCount
    loop {
        if (req.WaitForResponse(0.2))
            break
        if (GetKeyState("Escape", "P")) {
            req.Abort()
            throw Error("Cancelled.")
        }
        secs := Round((A_TickCount - start) / 1000)
        try progressGui["status"].Text := "Reading the prior report... " secs "s   (Esc to cancel)"
        if (A_TickCount - start > 185000) {
            req.Abort()
            throw Error("Timed out after 185 seconds.")
        }
    }

    status := req.Status
    text := ReadUtf8(req.ResponseBody)

    if (status != 200) {
        msg := JsonFindString(text, "message")
        throw Error("HTTP " . status . (msg = "" ? "`n`n" . SubStr(text, 1, 600) : "`n`n" . msg))
    }

    ; Response shape is {"content":[ ... {"type":"text","text":"..."} ... ]}.
    ; Find the text block specifically - a thinking block can precede it.
    p := RegExMatch(text, '"type"\s*:\s*"text"')
    if (!p)
        throw Error("No text block in the response.`n`n" SubStr(text, 1, 600))
    out := JsonFindString(text, "text", p)
    if (out = "")
        throw Error("Could not read the response text.`n`n" SubStr(text, 1, 600))
    return out
}

; ---------------------------------------------------------------------------
; Parsing the model output
; ---------------------------------------------------------------------------

ParseChecklist(raw, maxItems) {
    summary := ""
    items := []

    for line in StrSplit(raw, "`n", "`r") {
        line := Trim(line)
        if (line = "")
            continue
        ; Strip any stray bullet or numbering the model may have added.
        line := RegExReplace(line, "^[-*\x{2022}\s]+", "")

        parts := StrSplit(line, "|")
        if (parts.Length < 2)
            continue

        head := Trim(parts[1])
        if (head = "SUMMARY") {
            summary := Trim(parts[2])
            continue
        }
        if !RegExMatch(head, "^[123]$")
            continue
        if (items.Length >= maxItems)
            continue

        items.Push({tier: Integer(head),
                    item: Trim(parts[2]),
                    prior: parts.Length >= 3 ? Trim(parts[3]) : ""})
    }

    ; Belt and braces: the prompt asks for tier order, this guarantees it.
    n := items.Length
    loop n - 1 {
        i := A_Index
        loop n - i {
            j := A_Index
            if (items[j].tier > items[j + 1].tier) {
                tmp := items[j], items[j] := items[j + 1], items[j + 1] := tmp
            }
        }
    }
    return {summary: summary, items: items}
}

; ---------------------------------------------------------------------------
; Checklist window
; ---------------------------------------------------------------------------

TIER_LABEL(t) {
    if (t = 1)
        return "MUST ADDRESS"
    if (t = 2)
        return "SHOULD ADDRESS"
    return "MENTION IF CHANGED"
}

TIER_COLOR(t) {
    if (t = 1)
        return "B3261E"
    if (t = 2)
        return "A06400"
    return "6B6B6B"
}

ShowChecklistGui(summary, items) {
    global App, CFG_FILE

    if (App.gui) {
        try App.gui.Destroy()
        App.gui := ""
    }
    App.boxes := []
    App.summary := summary

    W := 610
    g := Gui("+AlwaysOnTop -MaximizeBox", "PET comparison checklist")
    g.BackColor := "FFFFFF"
    g.MarginX := 16
    g.MarginY := 14

    if (summary != "") {
        g.SetFont("s10 italic c4A4A4A", "Segoe UI")
        g.Add("Text", "xm w" W, summary)
    }

    g.SetFont("s9 norm c707070", "Segoe UI")
    App.progress := g.Add("Text", "xm y+6 w" W " h18", "0 of 0 addressed")

    lastTier := 0
    for it in items {
        if (it.tier != lastTier) {
            lastTier := it.tier
            g.SetFont("s8 bold c" TIER_COLOR(it.tier), "Segoe UI")
            g.Add("Text", "xm y+14 w" W, TIER_LABEL(it.tier))
            g.SetFont("s10 norm c202020", "Segoe UI")
        }

        label := it.item
        if (it.prior != "")
            label .= "   -   " it.prior

        ; Two rows of height when the line is long enough to wrap.
        h := StrLen(label) > 78 ? 38 : 22
        cb := g.Add("Checkbox", "xm y+7 w" W " h" h, label)
        cb.OnEvent("Click", OnItemToggled)
        App.boxes.Push({ctrl: cb, tier: it.tier, item: it.item, prior: it.prior})
    }

    g.SetFont("s9 norm c202020", "Segoe UI")
    g.Add("Button", "xm y+18 w150 h28", "Copy unaddressed").OnEvent("Click", (*) => CopyItems(false))
    g.Add("Button", "x+8 yp w110 h28", "Copy all").OnEvent("Click", (*) => CopyItems(true))
    g.Add("Button", "x+8 yp w110 h28", "Uncheck all").OnEvent("Click", (*) => UncheckAll())
    g.Add("Button", "x+8 yp w90 h28", "Hide").OnEvent("Click", (*) => HideChecklist(g))

    g.OnEvent("Close", HideChecklist)
    g.OnEvent("Escape", HideChecklist)

    App.gui := g
    UpdateProgress()

    x := IniRead(CFG_FILE, "window", "x", "")
    y := IniRead(CFG_FILE, "window", "y", "")
    if (x != "" && y != "" && !OnScreen(x, y))
        x := "", y := ""
    if (x != "" && y != "")
        g.Show("x" x " y" y " AutoSize")
    else
        g.Show("AutoSize")
}

; True when the point sits inside the virtual desktop, so a checklist saved
; on a monitor that is no longer attached does not reopen out of reach.
OnScreen(x, y) {
    vx := SysGet(76), vy := SysGet(77), vw := SysGet(78), vh := SysGet(79)
    return (x >= vx && y >= vy && x < vx + vw - 80 && y < vy + vh - 60)
}

HideChecklist(g, *) {
    SavePos(g)
    g.Hide()
    return true                          ; suppress the default destroy-on-close
}

OnItemToggled(ctrl, *) {
    ctrl.SetFont(ctrl.Value ? "cA0A0A0" : "c202020")
    try ctrl.Redraw()
    UpdateProgress()
}

UpdateProgress() {
    global App
    if (!App.progress)
        return
    done := 0
    mustLeft := 0
    for b in App.boxes {
        if (b.ctrl.Value)
            done++
        else if (b.tier = 1)
            mustLeft++
    }
    total := App.boxes.Length
    msg := done " of " total " addressed"
    if (mustLeft > 0)
        msg .= "   -   " . mustLeft . " must-address item" . (mustLeft = 1 ? "" : "s") . " still open"
    else if (done < total)
        msg .= "   -   all must-address items done"
    App.progress.Text := msg
}

UncheckAll() {
    global App
    for b in App.boxes {
        b.ctrl.Value := 0
        b.ctrl.SetFont("c202020")
        try b.ctrl.Redraw()
    }
    UpdateProgress()
}

CopyItems(includeChecked) {
    global App
    out := ""
    if (App.summary != "")
        out .= "Prior: " App.summary "`r`n`r`n"
    lastTier := 0
    count := 0
    for b in App.boxes {
        if (!includeChecked && b.ctrl.Value)
            continue
        if (b.tier != lastTier) {
            lastTier := b.tier
            out .= (count ? "`r`n" : "") . TIER_LABEL(b.tier) . "`r`n"
        }
        out .= "- " . b.item . (b.prior != "" ? "  (" . b.prior . ")" : "") . "`r`n"
        count++
    }
    if (count = 0) {
        ToolTip("Nothing left - every item is ticked.")
        SetTimer(() => ToolTip(), -1800)
        return
    }
    A_Clipboard := out
    ToolTip("Copied " . count . " item" . (count = 1 ? "" : "s") . ".")
    SetTimer(() => ToolTip(), -1400)
}

ToggleChecklist() {
    global App
    if (!App.gui) {
        ToolTip("No checklist yet - copy a prior report and press the build hotkey.")
        SetTimer(() => ToolTip(), -2200)
        return
    }
    if (DllCall("IsWindowVisible", "Ptr", App.gui.Hwnd))
        HideChecklist(App.gui)
    else
        App.gui.Show("NoActivate")
}

SavePos(g) {
    global CFG_FILE
    try {
        g.GetPos(&x, &y)
        IniWrite(x, CFG_FILE, "window", "x")
        IniWrite(y, CFG_FILE, "window", "y")
    }
}

ShowProgress() {
    p := Gui("+AlwaysOnTop -Caption +ToolWindow +Border")
    p.BackColor := "FFFFFF"
    p.MarginX := 18
    p.MarginY := 14
    p.SetFont("s10 c303030", "Segoe UI")
    p.Add("Text", "w330 vstatus", "Reading the prior report...   (Esc to cancel)")
    p.Show("AutoSize NoActivate")
    return p
}

EditSettings() {
    global CFG_FILE
    if (!FileExist(CFG_FILE))
        WriteDefaultIni(CFG_FILE)
    Run('notepad.exe "' CFG_FILE '"')
}

WriteDefaultIni(path) {
    FileAppend("
(
; SPDX-FileCopyrightText: Avecina Studio
; SPDX-License-Identifier: MIT

[api]
; Leave key blank to use the ANTHROPIC_API_KEY environment variable instead,
; which keeps the key out of this file.
key=
base_url=https://api.anthropic.com/v1/messages
model=claude-opus-5
; low | medium | high | xhigh | max - higher is more thorough and slower.
effort=medium
max_tokens=4000

[behavior]
scrub_phi=1
max_items=14
hotkey_build=^!p
hotkey_toggle=^!o
)", path)
}

; ---------------------------------------------------------------------------
; JSON helpers. The request is escaped to pure ASCII so the body encodes
; identically no matter what WinHttp decides to do with it.
; ---------------------------------------------------------------------------

JsonEscape(s) {
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, '"', '\"')
    s := StrReplace(s, "`r`n", "\n")
    s := StrReplace(s, "`n", "\n")
    s := StrReplace(s, "`r", "\n")
    s := StrReplace(s, "`t", "\t")

    out := ""
    loop parse s {
        c := Ord(A_LoopField)
        if (c < 32)
            continue                      ; drop remaining control characters
        else if (c > 126)
            out .= "\u" Format("{:04x}", c)
        else
            out .= A_LoopField
    }
    return out
}

; Finds "<key>":" at or after startPos and returns the unescaped string value.
JsonFindString(json, key, startPos := 1) {
    needle := '"' key '":'
    p := InStr(json, needle, false, startPos)
    if (!p)
        return ""
    p += StrLen(needle)

    ; Skip whitespace, then require an opening quote.
    while (p <= StrLen(json) && InStr(" `t`r`n", SubStr(json, p, 1)))
        p++
    if (SubStr(json, p, 1) != '"')
        return ""
    p++

    out := ""
    while (p <= StrLen(json)) {
        ch := SubStr(json, p, 1)
        if (ch = '"')
            break
        if (ch = "\") {
            esc := SubStr(json, p + 1, 1)
            switch esc {
                case '"': out .= '"',  p += 2
                case "\": out .= "\",  p += 2
                case "/": out .= "/",  p += 2
                case "b": out .= "`b", p += 2
                case "f": out .= Chr(12), p += 2
                case "n": out .= "`n", p += 2
                case "r": out .= "`r", p += 2
                case "t": out .= "`t", p += 2
                case "u": out .= Chr("0x" SubStr(json, p + 2, 4)), p += 6
                default:  out .= esc,  p += 2
            }
        } else {
            out .= ch
            p++
        }
    }
    return out
}

ReadUtf8(bodyArray) {
    s := ComObject("ADODB.Stream")
    s.Type := 1                 ; binary
    s.Open()
    s.Write(bodyArray)
    s.Position := 0
    s.Type := 2                 ; text
    s.Charset := "utf-8"
    txt := s.ReadText()
    s.Close()
    return txt
}
