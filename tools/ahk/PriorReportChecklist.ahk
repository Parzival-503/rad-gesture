; SPDX-FileCopyrightText: Avecina Studio
; SPDX-License-Identifier: MIT
;
; PriorReportChecklist.ahk
;
; Select the text of a PRIOR radiology report (in PACS, the dictation system, the EMR,
; anywhere), press the hotkey, and get a short pre-read checklist of the things that prior
; obliges you to address on the exam you are about to read.
;
; It is deliberately NOT a summary of the prior. See PROMPT below for the rules that keep
; it short.
;
; PHI WARNING: this sends report text to whatever endpoint you configure in API_URL. Only
; point it at an endpoint your institution has approved for patient data. See README.md.

#Requires AutoHotkey v2.0
#SingleInstance Force

; ---------------------------------------------------------------------------------------
; Configuration
; ---------------------------------------------------------------------------------------

; Hotkeys. ^ = Ctrl, ! = Alt, + = Shift, # = Win.
HOTKEY_RUN    := "^!p"   ; Ctrl+Alt+P  -> copy the selection, build the checklist
HOTKEY_RECALL := "^!o"   ; Ctrl+Alt+O  -> re-show the last checklist, no second API call

; Where the report text is sent. Swap this for your institution's approved endpoint if you
; have one; anything that speaks the Anthropic Messages API will work unchanged.
API_URL   := "https://api.anthropic.com/v1/messages"
API_MODEL := "claude-sonnet-5"

; The longest checklist you ever want to see. Keeping this small is the whole point.
MAX_ITEMS := 8

LastChecklist := ""
ResultGui := ""

Hotkey HOTKEY_RUN, RunChecklist
Hotkey HOTKEY_RECALL, RecallChecklist

; The API key is read from, in order:
;   1. the ANTHROPIC_API_KEY environment variable
;   2. a file named api-key.txt next to this script (key on the first line, nothing else)
; Do not paste the key into this file - this file is checked into git.
GetApiKey() {
  key := Trim(EnvGet("ANTHROPIC_API_KEY"), " `t`r`n")
  if (key != "")
    return key
  path := A_ScriptDir "\api-key.txt"
  if FileExist(path)
    return Trim(StrSplit(FileRead(path, "UTF-8"), "`n")[1], " `t`r`n")
  return ""
}

; ---------------------------------------------------------------------------------------
; The prompt - this is the part worth tuning
;
; {MAXITEMS} and {TODAY} are substituted in BuildPrompt().
; ---------------------------------------------------------------------------------------

PROMPT := "
(
You are helping a radiologist who is about to read a NEW exam. Below is the patient's PRIOR
report. Produce a short pre-read checklist: the specific things this prior obliges the
radiologist to look at and account for on the new exam.

This is not a summary. Do not restate the report. Every line must be something to DO.

Format - plain text, no markdown, no preamble, no closing remarks:

Line 1: the prior's exam type and date, e.g. CT A/P with contrast - 2024-03-11. Write
'date not stated' if you cannot find it.

Then a section headed exactly IMPRESSION: with one line per numbered impression item, in
the prior's own order. Each line reads: - <finding, with site and size> -> <action>. These
are the items that must each get an explicit disposition on the new read.

Then, only if any qualify, a section headed exactly ALSO CHECK: for items that appear in
the BODY of the prior but not in its impression. An item qualifies ONLY if it is one of:
  - a lesion with a stated measurement, series number, or image number
  - an explicit follow-up recommendation, with its interval
  - a device, line, tube, stent, drain, or hardware whose position was described
  - post-operative anatomy, a resection, or an anatomic variant that changes how the new
    exam should be interpreted
  - a stated technical limitation (motion, poor opacification, truncated coverage, a
    non-diagnostic sequence) that you should check has resolved
  - an incidental finding carrying a management recommendation

Never include: normal or negative statements, technique and contrast boilerplate, chronic
degenerative or stable findings that were not in the impression, and anything already
covered by an impression line.

Hard rules:
  - At most {MAXITEMS} lines total across both sections. If there are more candidates, keep
    the ones that would most change patient management and drop the rest silently.
  - At most about 15 words per line. Terse and telegraphic, not full sentences.
  - Carry the numbers across verbatim: sizes in mm or cm, series and image numbers, dates,
    laterality, segment or level. Those are what make re-measurement possible.
  - Use a concrete action verb: re-measure, compare, confirm resolution, assess interval
    change, check position, verify coverage.
  - If the prior recommends follow-up, state the interval and whether it is now due, given
    that today is {TODAY}. Write (due) or (not yet due).
  - If the prior contains nothing actionable, output the header line and then the single
    line 'Nothing actionable in prior.' and stop.

PRIOR REPORT:
)"

BuildPrompt(report, maxItems) {
  global PROMPT
  text := StrReplace(PROMPT, "{MAXITEMS}", maxItems)
  text := StrReplace(text, "{TODAY}", FormatTime(A_Now, "yyyy-MM-dd"))
  return text "`n" report
}

; ---------------------------------------------------------------------------------------
; Minimal JSON helpers (AutoHotkey v2 has no JSON built in)
; ---------------------------------------------------------------------------------------

JsonEscape(s) {
  s := StrReplace(s, "\", "\\")
  s := StrReplace(s, '"', '\"')
  s := StrReplace(s, "`r`n", "\n")
  s := StrReplace(s, "`n", "\n")
  s := StrReplace(s, "`r", "\n")
  s := StrReplace(s, "`t", "\t")
  ; Drop any remaining control characters, which would make the JSON invalid.
  out := ""
  Loop Parse, s
    out .= (Ord(A_LoopField) < 32) ? " " : A_LoopField
  return out
}

JsonUnescape(s) {
  out := "", i := 1, len := StrLen(s)
  while (i <= len) {
    c := SubStr(s, i, 1)
    if (c != "\") {
      out .= c
      i += 1
      continue
    }
    n := SubStr(s, i + 1, 1)
    if (n = "n") {
      out .= "`r`n"
      i += 2
    } else if (n = "t") {
      out .= "`t"
      i += 2
    } else if (n = "r") {
      i += 2                                    ; CR is folded into the \n case above
    } else if (n = "u") {
      out .= Chr(Integer("0x" SubStr(s, i + 2, 4)))
      i += 6
    } else {
      out .= n
      i += 2
    }
  }
  return out
}

; Pull the first "text":"..." value out of a Messages API response, respecting escapes.
ExtractText(json) {
  start := InStr(json, '"text":"')
  if (!start)
    return ""
  i := start + 8, out := "", len := StrLen(json)
  while (i <= len) {
    c := SubStr(json, i, 1)
    if (c = "\") {
      out .= c SubStr(json, i + 1, 1)
      i += 2
      continue
    }
    if (c = '"')
      break
    out .= c
    i += 1
  }
  return JsonUnescape(out)
}

; ---------------------------------------------------------------------------------------
; API call
; ---------------------------------------------------------------------------------------

CallModel(report) {
  global API_URL, API_MODEL, MAX_ITEMS
  key := GetApiKey()
  if (key = "")
    return "ERROR: No API key.`r`nSet ANTHROPIC_API_KEY, or put the key in api-key.txt next to this script."

  body := '{"model":"' API_MODEL '","max_tokens":600,"messages":[{"role":"user","content":"'
       . JsonEscape(BuildPrompt(report, MAX_ITEMS)) '"}]}'

  try {
    http := ComObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts(5000, 10000, 10000, 60000)
    http.Open("POST", API_URL, false)
    http.SetRequestHeader("content-type", "application/json")
    http.SetRequestHeader("x-api-key", key)
    http.SetRequestHeader("anthropic-version", "2023-06-01")
    http.Send(body)
  } catch as e {
    return "ERROR: Could not reach " API_URL "`r`n" e.Message
  }

  if (http.Status != 200)
    return "ERROR: the API returned " http.Status "`r`n" SubStr(http.ResponseText, 1, 500)

  text := Trim(ExtractText(http.ResponseText), " `t`r`n")
  return (text = "") ? "ERROR: empty response from the model." : text
}

; ---------------------------------------------------------------------------------------
; Result window
; ---------------------------------------------------------------------------------------

ShowChecklist(text) {
  global LastChecklist, ResultGui
  LastChecklist := text

  if IsObject(ResultGui) {
    try ResultGui.Destroy()
    ResultGui := ""
  }

  g := Gui("+AlwaysOnTop +Resize", "Prior report - pre-read checklist")
  g.BackColor := "1E1E1E"
  g.MarginX := 10, g.MarginY := 10
  g.SetFont("s10 cWhite", "Consolas")
  g.AddEdit("vBody w620 r20 ReadOnly -E0x200 Background1E1E1E", text)
  g.SetFont("s9")
  g.AddButton("vCopyBtn xm y+8 w100", "Copy").OnEvent("Click", CopyChecklist)
  g.AddButton("vCloseBtn x+8 w100", "Close").OnEvent("Click", CloseChecklist)
  g.OnEvent("Escape", CloseChecklist)
  g.OnEvent("Close", CloseChecklist)
  g.OnEvent("Size", ResizeChecklist)
  ResultGui := g
  g.Show()
}

CopyChecklist(*) {
  global LastChecklist
  A_Clipboard := LastChecklist
  ToolTip "Checklist copied."
  SetTimer(() => ToolTip(), -1200)
}

CloseChecklist(*) {
  global ResultGui
  if IsObject(ResultGui) {
    try ResultGui.Destroy()
    ResultGui := ""
  }
}

ResizeChecklist(thisGui, minMax, width, height) {
  if (minMax = -1)   ; minimised
    return
  thisGui["Body"].Move(, , width - 20, height - 60)
  thisGui["CopyBtn"].Move(, height - 40)
  thisGui["CloseBtn"].Move(, height - 40)
}

; ---------------------------------------------------------------------------------------
; Hotkey handlers
; ---------------------------------------------------------------------------------------

RunChecklist(*) {
  saved := ClipboardAll()
  A_Clipboard := ""
  Send "^c"
  if !ClipWait(1.5) {
    A_Clipboard := saved
    MsgBox("Nothing was copied.`n`nSelect the text of the prior report first, then press the hotkey.", "Prior report checklist", "Icon!")
    return
  }
  report := Trim(A_Clipboard, " `t`r`n")
  A_Clipboard := saved

  if (StrLen(report) < 200) {
    MsgBox("That selection is only " StrLen(report) " characters, so it does not look like a full report.`n`nSelect the whole prior report and try again.", "Prior report checklist", "Icon!")
    return
  }

  ToolTip "Reading the prior report..."
  Sleep 50
  result := CallModel(report)
  ToolTip
  ShowChecklist(result)
}

RecallChecklist(*) {
  global LastChecklist
  if (LastChecklist = "")
    MsgBox("No checklist yet this session.", "Prior report checklist")
  else
    ShowChecklist(LastChecklist)
}
