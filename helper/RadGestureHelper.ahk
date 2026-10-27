; ============================================================================
; RadGesture helper - the "hands" behind the RadGesture ring
; ----------------------------------------------------------------------------
; The hub (the Electron app) draws the ring. This script owns the keyboard
; (Ctrl+CapsLock opens the ring) and does everything that types, copies or
; touches PowerScribe, so every PowerScribe safety rule lives in one place.
; It also holds the AI tools (proofread, prior checklist, impression,
; one-liner) and the function collection (Settings > Functions).
; Settings, key and history live in %APPDATA%\RadGesture\ (the bridge section
; at the bottom of this file explains how the hub and helper talk).
; ============================================================================
; Proofread - AI-powered dictation error detector for radiology reports
; ----------------------------------------------------------------------------
; Hotkeys:
;   Ctrl+Alt+Q    - Proofread current report
;   (Settings)    - Tray icon -> right click -> Settings...
;
; Prior checklist mode (see the section at the bottom of this file):
;   Copy a prior report (in PACS: select it, right-click -> Copy), then press
;   "+ Add" on the small Priors window. Repeat for each prior. "Checklist"
;   sends the priors plus the current PowerScribe exam title to Claude and
;   shows 3-8 things to double-check. Neither window ever takes focus.
;   Optional hotkeys: Settings > Shortcuts (Add prior, Prior checklist).
;
; One-liner: select text anywhere, Ctrl+Alt+U
; (or the toolbar's One-liner button), pick a flavor; result on clipboard.
;
; Impression: in PowerScribe press the toolbar's Impression button (or the
; [Impression] Hotkey). Writes a very short impression from the FINDINGS with
; no measurements, puts it on the clipboard, and offers "Open in
; OpenEvidence" (copies your rules + findings and opens the site).
;
; Workflow:
;   1. Cursor in PowerScribe report pane, hit Ctrl+Alt+Q
;   2. Script does Ctrl+A, Ctrl+C to grab the report
;   3. Sends to Claude with a radiology-tuned proofreading prompt that
;      catches three error types: section-context mismatches (e.g.
;      "cholecystectomy" under "Vessels:"), broken/nonsensical text
;      (word salad from dictation glitches), and word substitutions.
;   4. Two-pane HTML popup: report on left with red highlights,
;      findings on right with reasons + suggestions.
;   5. Each session is logged to RadProofread_history.jsonl for review.
;
; Settings persist in:  %APPDATA%\RadGesture\RadGesture.ini
; History stored in:    %APPDATA%\RadGesture\RadProofread_history.jsonl
; Tray menu: Settings, Test API Key, View History, Open Settings, Reload, Exit.
;
; Models: claude-sonnet-5-5 (default), claude-haiku-5-5 (cheapest, fastest),
; claude-opus-5-5 (most careful). These models think before answering by
; default and reject "temperature", so requests send an effort level instead,
; and max_tokens leaves room for the thinking (see ApiExtras()). A saved older
; model is moved to Sonnet 5.5 on load (NormalizeModel()).
;
; Dependencies: AHK v1.1 + WinHttp.WinHttpRequest.5.1 (built into Windows).
; No external libraries.
; ============================================================================

#Requires AutoHotkey v1.1.33+
#NoEnv
#SingleInstance Force
SendMode Input
SetWorkingDir %A_ScriptDir%
SetTitleMatchMode, 2
SetBatchLines, -1

; ----------------------------------------------------------------------------
; Globals + defaults
; ----------------------------------------------------------------------------
; Writable per-user folder: the helper is installed with the hub, where the
; script's own folder may not be writable and is replaced on every update.
; The hub passes its data folder (same place by default, a temp folder in tests).
EnvGet, g_DataDirEnv, RG_DATA_DIR
global g_DataDir := (g_DataDirEnv != "") ? g_DataDirEnv : A_AppData . "\RadGesture"
global INI_PATH := g_DataDir . "\RadGesture.ini"
global API_URL  := "https://api.anthropic.com/v1/messages"
global API_VERSION := "2023-06-01"

global g_ApiKey      := ""
global g_Model       := "claude-sonnet-5-5"
global g_Sensitivity := "moderate"     ; conservative | moderate | aggressive
global g_MaxTokens   := 1500
global g_Hotkey      := "^!q"          ; Ctrl+Alt+Q
global g_StripHeader := 1              ; try to skip everything before "FINDINGS:" / "REPORT:" etc.
global g_ShowOnEmpty := 1              ; show popup even if no flags (green "all clear")
global g_LogHistory  := 1              ; log each session to history file
global g_BoundHotkey := ""
global HISTORY_PATH := g_DataDir . "\RadProofread_history.jsonl"

; Prior checklist mode. Declared here, inside the auto-execute section, so the
; initial values are actually assigned at startup.
global g_Priors          := []   ; each: {text, added (A_Now)}
global g_PriorLast       := ""   ; A_Now of the last add, for expiry
global g_PriorExpireMin  := 30   ; bin empties itself after this many idle minutes (0 = never)
global g_PriorCapture    := "clipboard"  ; clipboard | selectall
global g_PriorAddHotkey  := ""   ; empty = no hotkey, use the window's buttons
global g_PriorListHotkey := ""
global g_PriorMaxTokens  := 600
global g_PriorBoundAdd   := ""
global g_PriorBoundList  := ""
global g_PriorBinShown   := false
global g_PriorAtStartup  := 1    ; the floating Priors toolbar (Settings > AI tools can hide it)
global g_PriorListText   := ""   ; the last checklist, for Insert / Copy

; Chart bin for the one-liner: pieces of the chart copied one by one, turned
; into one one-liner together, then emptied. Same idle expiry as the priors.
global g_Chart           := []   ; each: {text, added (A_Now)}
global g_ChartLast       := ""   ; A_Now of the last add
global g_ChartAddHotkey  := ""   ; optional (Settings > Shortcuts)
global g_BoundChartAdd   := ""
global g_FromChart       := false ; the one-liner being made came from the bin
global g_ChartAskHwnd    := 0     ; the "empty the chart text?" box, while shown

; One-liner and impression helper.
global g_OneLinerHotkey  := "^!u" ; Ctrl+Alt+U
global g_ImpHotkey       := ""    ; blank = toolbar button only
global g_ImpRules        := "Keep it very short. No measurements or other numbers."
global g_ImpMaxTokens    := 400
global g_ImpModel        := ""    ; "" = same model as the other tools; or claude-opus-5-5
global g_BoundOneLiner   := ""
global g_BoundImp        := ""
global g_ImpLastFindings := ""
global g_ImpLastText     := ""
global TOAST_MS          := 2200
global g_Busy            := false
global g_PickerHwnd      := 0
global g_ToastHwnd       := 0
global g_UiHub           := false ; the hub draws the small windows (toolbar, cards, toasts)
global g_ToolbarOn       := false ; the hub's toolbar is showing
global g_ToastHub        := false ; the hub shows a toast now
global g_CardUntil       := 0     ; a hub card or picker may be open until this tick
global g_ChartAskHub     := false ; the hub card asks "empty the chart text?"
global g_PickerHub       := false ; the hub's one-liner picker is open
global g_SavedClip       := ""
global g_PendingText     := ""
global g_DirectFlavor    := ""    ; set by the ring: skip the flavor picker

; Function collection (section at the bottom). Every id
; must be in config/library.json and the other way round.
global LIB_IDS := "PS_ToggleDictation|PS_NextField|PS_PrevField|PS_PasteIndication"
    . "|PACS_WL_SoftTissue|PACS_WL_Lung|PACS_WL_Bone|PACS_WL_Brain|PACS_WL_Stroke|PACS_Enhance|PACS_Sharpen"
    . "|PACS_Distance|PACS_Orthogonal|PACS_ROI|PACS_Arrow|PACS_Circle|PACS_Insert_Measurement"
    . "|PACS_Crosshair|PACS_LinkCrosshair|PACS_Prev_Key_Image|PACS_Next_Key_Image"
    . "|PACS_Prev_Layout|PACS_Next_Layout|PACS_Layout_2x2|PACS_Layout_3x2|PACS_Layout_3x3"
    . "|PACS_MPR|PACS_Matrix|PACS_ImageWindow|PACS_Insert_Priors"
    . "|PACS_Pinpoint|PACS_Show_Report|PACS_Thick_Slab|PACS_Slab_Off|PACS_Invert|PACS_Reset"
    . "|LoginUandP|LoginU|LoginP|LoginForget|ActivateEPIC|ActivateTeams|OpenChromeTabs|SearchRadiopaediaGoogle"
global g_LibBound := {}     ; hotkey -> library id, for LibHotkey
global g_LibPass := ""      ; the login password, this session only (never written anywhere)
global g_LibSearchTerm := ""
global g_LibKeyId := ""

; Bridge to the RadGesture hub (see the section at the bottom).
global g_HubTrigger      := "^CapsLock"
global g_HubBoundDown    := ""
global g_HubBoundUp      := ""
global g_HubPort         := 47811
global g_HubToken        := ""
global g_RingOpen        := false
global g_HubLastErr      := ""    ; why the last HubRequest got no answer

; Proofread windows (the old built-in one, and RadGesture's).
global g_PopupFlags := []   ; flags backing the currently-open popup
global g_PopupHwnd  := 0    ; HWND of the PowerScribe window we copied from
global g_FindBusy   := false ; true while a Find action is in progress
global g_ResolvedMap := {}  ; idx -> bool, tracks user "resolved" checkbox state
global g_PopupReport := ""  ; report text for the currently-open popup (for logging on close)
global g_ProofHub := false  ; true while RadGesture's own proofread window shows the results
global g_ProofSeq := 0      ; which proofread the hub window shows (its messages carry it)
global g_ProofSessions := {} ; seq -> {report, flags}, until the hub says the window closed

FileCreateDir, %g_DataDir%
MigrateOldSettings()
LoadSettings()
RegisterLibraryHotkeys()
RegisterHotkey()
RegisterPriorHotkeys()
RegisterToolHotkeys()
RegisterHubHotkeys()
BuildTrayMenu()
; Started by the RadGesture app (it passes RG_DATA_DIR): the app's own tray
; icon is the one to use, so this one stays hidden. Run on its own, it shows.
if (g_DataDirEnv != "")
    Menu, Tray, NoIcon
SetTimer, HubPoll, 750
if (g_PriorAtStartup)
    ShowPriorBin()
; CI runs "--selftest": the whole script has loaded and every startup step
; above has run, so report and leave (tests-e2e / the Windows build job).
if (A_Args[1] = "--selftest") {
    FileAppend, SELFTEST OK`n, *
    ExitApp, 0
}
return

; ----------------------------------------------------------------------------
; Settings load / save (INI)
; ----------------------------------------------------------------------------
LoadSettings() {
    global
    if !FileExist(INI_PATH) {
        SaveSettings()
        return
    }
    IniRead, v, %INI_PATH%, API, ApiKey, %A_Space%
    g_ApiKey := CleanApiKey(v)
    IniRead, v, %INI_PATH%, API, Model, claude-sonnet-5-5
    g_Model := NormalizeModel(v)
    IniRead, v, %INI_PATH%, API, MaxTokens, 1500
    g_MaxTokens := v + 0
    IniRead, v, %INI_PATH%, Behavior, Sensitivity, moderate
    g_Sensitivity := v
    IniRead, v, %INI_PATH%, Behavior, Hotkey, ^!q
    g_Hotkey := v
    IniRead, v, %INI_PATH%, Behavior, StripHeader, 1
    g_StripHeader := v + 0
    IniRead, v, %INI_PATH%, Behavior, ShowOnEmpty, 1
    g_ShowOnEmpty := v + 0
    IniRead, v, %INI_PATH%, Behavior, LogHistory, 1
    g_LogHistory := v + 0
    IniRead, v, %INI_PATH%, Priors, AddHotkey, %A_Space%
    g_PriorAddHotkey := Trim(v)
    IniRead, v, %INI_PATH%, Priors, ChecklistHotkey, %A_Space%
    g_PriorListHotkey := Trim(v)
    IniRead, v, %INI_PATH%, Priors, ExpireMinutes, 30
    g_PriorExpireMin := v + 0
    IniRead, v, %INI_PATH%, Priors, CaptureMode, clipboard
    g_PriorCapture := (v = "selectall") ? "selectall" : "clipboard"
    IniRead, v, %INI_PATH%, Priors, ShowAtStartup, 1
    g_PriorAtStartup := v + 0
    IniRead, v, %INI_PATH%, OneLiner, Hotkey, ^!u
    g_OneLinerHotkey := Trim(v)
    IniRead, v, %INI_PATH%, OneLiner, ChartAddHotkey, %A_Space%
    g_ChartAddHotkey := Trim(v)
    IniRead, v, %INI_PATH%, Impression, Hotkey, %A_Space%
    g_ImpHotkey := Trim(v)
    IniRead, v, %INI_PATH%, Impression, ExtraRules, %g_ImpRules%
    g_ImpRules := Trim(v)
    IniRead, v, %INI_PATH%, Impression, Model, %A_Space%
    g_ImpModel := Trim(v)
    IniRead, v, %INI_PATH%, Hub, Trigger, ^CapsLock
    g_HubTrigger := Trim(v)
    ; Write the [Priors] keys back so they show up in an existing INI and can
    ; be edited from Tray -> Open Settings File.
    SaveExtraSettings()
}

SaveExtraSettings() {
    global
    IniWrite, %g_PriorAddHotkey%,  %INI_PATH%, Priors, AddHotkey
    IniWrite, %g_PriorListHotkey%, %INI_PATH%, Priors, ChecklistHotkey
    IniWrite, %g_PriorExpireMin%,  %INI_PATH%, Priors, ExpireMinutes
    IniWrite, %g_PriorCapture%,    %INI_PATH%, Priors, CaptureMode
    IniWrite, %g_PriorAtStartup%,  %INI_PATH%, Priors, ShowAtStartup
    IniWrite, %g_OneLinerHotkey%,  %INI_PATH%, OneLiner, Hotkey
    IniWrite, %g_ImpHotkey%,       %INI_PATH%, Impression, Hotkey
    IniWrite, %g_ImpRules%,        %INI_PATH%, Impression, ExtraRules
    IniWrite, %g_HubTrigger%,      %INI_PATH%, Hub, Trigger
}

SaveSettings() {
    global
    IniWrite, %g_ApiKey%,      %INI_PATH%, API, ApiKey
    IniWrite, %g_Model%,       %INI_PATH%, API, Model
    IniWrite, %g_MaxTokens%,   %INI_PATH%, API, MaxTokens
    IniWrite, %g_Sensitivity%, %INI_PATH%, Behavior, Sensitivity
    IniWrite, %g_Hotkey%,      %INI_PATH%, Behavior, Hotkey
    IniWrite, %g_StripHeader%, %INI_PATH%, Behavior, StripHeader
    IniWrite, %g_ShowOnEmpty%, %INI_PATH%, Behavior, ShowOnEmpty
    IniWrite, %g_LogHistory%,  %INI_PATH%, Behavior, LogHistory
    SaveExtraSettings()
}

; ----------------------------------------------------------------------------
; Hotkey registration (re-bindable from Settings)
; ----------------------------------------------------------------------------
RegisterHotkey() {
    global
    if (g_BoundHotkey != "") {
        try Hotkey, %g_BoundHotkey%, Off
    }
    try {
        Hotkey, %g_Hotkey%, ProofreadHotkey, On
        g_BoundHotkey := g_Hotkey
    } catch e {
        MsgBox, 48, RadGesture, Could not bind hotkey "%g_Hotkey%":`n%e%
    }
}

ProofreadHotkey:
    ProofreadActiveReport()
return

; ----------------------------------------------------------------------------
; Tray menu
; ----------------------------------------------------------------------------
BuildTrayMenu() {
    global g_Model
    Menu, Tray, NoStandard
    Menu, Tray, Add, RadGesture helper, TrayHeader
    Menu, Tray, Disable, RadGesture helper
    Menu, Tray, Add, % "Model: " . g_Model, TrayHeader
    Menu, Tray, Disable, % "Model: " . g_Model
    Menu, Tray, Add
    Menu, Tray, Add, Settings..., MenuSettings
    Menu, Tray, Add, Test API Key, MenuTestKey
    Menu, Tray, Add, View History, MenuHistory
    Menu, Tray, Add, Show Last API Call (debug), MenuDebug
    Menu, Tray, Add, Open Settings File, MenuOpenIni
    Menu, Tray, Add
    ; Submenu must be built before it is attached.
    Menu, PriorMenu, Add, Show Priors Window, MenuPriorShow
    Menu, PriorMenu, Add, Add Copied Prior, MenuPriorAdd
    Menu, PriorMenu, Add, Make Checklist, MenuPriorList
    Menu, PriorMenu, Add, Clear Priors, MenuPriorClear
    Menu, Tray, Add, Prior Checklist, :PriorMenu
    Menu, Tray, Add
    Menu, Tray, Add, Reload Script, MenuReload
    Menu, Tray, Add, Quit RadGesture, MenuExit
    Menu, Tray, Default, Settings...
    Menu, Tray, Tip, % "RadGesture helper (" . g_Model . ") - Ctrl+CapsLock opens the ring"
}

TrayHeader:
return

MenuSettings:
    OpenAiSettings()
return

MenuTestKey:
    TestApiKey()
return

MenuHistory:
    ShowHistoryViewer()
return

MenuDebug:
    ShowLastApiCall()
return

MenuOpenIni:
    Run, notepad.exe "%INI_PATH%"
return

MenuPriorShow:
    PriorBinSetWanted(true)
    ShowPriorBin()
return

MenuPriorAdd:
    PriorAdd()
return

MenuPriorList:
    PriorChecklist()
return

MenuPriorClear:
    PriorClear()
return

; Reload must not start a second copy behind RadGesture's back (it fought
; the hub's own restarts and left a stray helper with its Priors toolbar).
; Exiting lets the hub start a fresh one, which reads everything again.
MenuReload:
    ExitApp, 3
return

; The helper is part of RadGesture: Exit quits the whole thing, otherwise
; the hub would just start the helper again.
MenuExit:
    if (HubRequest("POST", "/quit") = "")
        ExitApp
return

; ----------------------------------------------------------------------------
; Settings GUI
; ----------------------------------------------------------------------------
ShowSettingsGui() {
    global

    Gui, SetGui:Destroy
    Gui, SetGui:+AlwaysOnTop +ToolWindow -DPIScale
    Gui, SetGui:Color, 1e1e1e, 252525
    Gui, SetGui:Font, s10 cE8E8E8, Segoe UI

    Gui, SetGui:Add, Text, x16 y14 w400, RadGesture Settings

    Gui, SetGui:Font, s9 cAAAAAA Bold, Segoe UI
    Gui, SetGui:Add, Text, x16 y44 w400, API
    Gui, SetGui:Font, s9 cE8E8E8 Norm, Segoe UI

    Gui, SetGui:Add, Text, x16 y68 w110, API Key:
    Gui, SetGui:Add, Edit, x130 y65 w360 h22 vSetGui_ApiKey Password*, %g_ApiKey%
    Gui, SetGui:Add, Checkbox, x495 y67 w16 h20 vSetGui_ShowKey gToggleKeyVisibility,

    Gui, SetGui:Font, s7 c888888
    Gui, SetGui:Add, Text, x130 y89 w380, Stored in %APPDATA%\RadGesture\RadGesture.ini on this PC.
    Gui, SetGui:Font, s9 cE8E8E8

    Gui, SetGui:Add, Text, x16 y110 w110, Model:
    Gui, SetGui:Add, DropDownList, x130 y107 w200 vSetGui_Model
        , % BuildDdl(["claude-sonnet-5-5","claude-haiku-5-5","claude-opus-5-5"], g_Model)

    Gui, SetGui:Add, Text, x16 y140 w110, Max tokens:
    Gui, SetGui:Add, Edit, x130 y137 w80 vSetGui_MaxTok Number, %g_MaxTokens%
    Gui, SetGui:Font, s7 c888888
    Gui, SetGui:Add, Text, x220 y141 w300, Output cap. 1500 is plenty for a per-report flag list.
    Gui, SetGui:Font, s9 cE8E8E8

    Gui, SetGui:Font, s9 cAAAAAA Bold
    Gui, SetGui:Add, Text, x16 y180 w400, Behavior
    Gui, SetGui:Font, s9 cE8E8E8 Norm

    Gui, SetGui:Add, Text, x16 y204 w110, Sensitivity:
    Gui, SetGui:Add, DropDownList, x130 y201 w200 vSetGui_Sens
        , % BuildDdl(["conservative","moderate","aggressive"], g_Sensitivity)

    Gui, SetGui:Add, Text, x16 y234 w110, Hotkey:
    Gui, SetGui:Add, Hotkey, x130 y231 w200 vSetGui_Hotkey, %g_Hotkey%
    Gui, SetGui:Font, s7 c888888
    Gui, SetGui:Add, Text, x340 y235 w180, Default: Ctrl+Alt+Q
    Gui, SetGui:Font, s9 cE8E8E8

    Gui, SetGui:Add, Checkbox, x130 y265 w360 vSetGui_StripHdr Checked%g_StripHeader%
        , Strip patient header (skip text before FINDINGS / REPORT)
    Gui, SetGui:Add, Checkbox, x130 y288 w360 vSetGui_ShowEmpty Checked%g_ShowOnEmpty%
        , Show popup even when no flags ("all clear" view)
    Gui, SetGui:Add, Checkbox, x130 y311 w360 vSetGui_LogHist Checked%g_LogHistory%
        , Log each proofreading session to history file

    Gui, SetGui:Add, Button, x16  y353 w110 h28 gSetGui_Test, Test API Key
    Gui, SetGui:Add, Button, x290 y353 w95  h28 gSetGui_Cancel, Cancel
    Gui, SetGui:Add, Button, x393 y353 w110 h28 gSetGui_Save Default, Save

    Gui, SetGui:Show, w520 h398, RadGesture Settings
    return

ToggleKeyVisibility:
    GuiControlGet, show,, SetGui_ShowKey
    GuiControl, +Password%A_Space%, SetGui_ApiKey
    if (!show)
        GuiControl, +Password*, SetGui_ApiKey
    return

SetGui_Save:
    Gui, SetGui:Submit, NoHide
    g_ApiKey      := CleanApiKey(SetGui_ApiKey)
    g_Model       := SetGui_Model
    g_Sensitivity := SetGui_Sens
    g_MaxTokens   := SetGui_MaxTok ? (SetGui_MaxTok+0) : 1500
    g_StripHeader := SetGui_StripHdr
    g_ShowOnEmpty := SetGui_ShowEmpty
    g_LogHistory  := SetGui_LogHist

    newHotkey := SetGui_Hotkey
    if (newHotkey = "")
        newHotkey := "^!q"
    if (newHotkey != g_Hotkey) {
        g_Hotkey := newHotkey
        RegisterHotkey()
    }

    SaveSettings()
    Menu, Tray, DeleteAll
    BuildTrayMenu()
    Gui, SetGui:Destroy
    Toast("Settings saved.", "ok", 2000)
    return

SetGui_Cancel:
SetGuiGuiClose:
SetGuiGuiEscape:
    Gui, SetGui:Destroy
    return

SetGui_Test:
    Gui, SetGui:Submit, NoHide
    testKey   := CleanApiKey(SetGui_ApiKey)
    testModel := SetGui_Model
    if (testKey = "") {
        MsgBox, 48, RadGesture, Enter an API key first.
        return
    }
    Gui, SetGui:+OwnDialogs
    res := PingClaude(testKey, testModel)
    if (res.ok)
        MsgBox, 4160, RadGesture - API Test, OK. Model "%testModel%" responded.
    else
        MsgBox, 4112, RadGesture - API Test, % "Failed:`n`n" . res.error
    return
}

BuildDdl(items, current) {
    s := ""
    for i, v in items {
        s .= v
        if (v = current)
            s .= "|"
        s .= "|"
    }
    return s
}

; ----------------------------------------------------------------------------
; Main proofreading flow
; ----------------------------------------------------------------------------
ProofreadActiveReport() {
    global g_ApiKey, g_StripHeader, g_ShowOnEmpty

    if (!HaveKey()) {
        MsgBox, 4144, RadGesture, No API key yet.`n`nPaste it in RadGesture Settings > AI tools (left-click the RadGesture tray icon).
        OpenAiSettings()
        return
    }
    if (CopyBlocked()) {
        Notify("Proofread: click in the report first.", 3000)
        return
    }

    savedClip := ClipboardAll
    Clipboard := ""
    Send, ^a
    Sleep, 50
    Send, ^c
    ClipWait, 2
    if ErrorLevel {
        Clipboard := savedClip
        Notify("RadGesture: clipboard copy failed", 1500)
        return
    }
    reportText := Clipboard
    Clipboard := savedClip

    reportText := Trim(reportText, " `t`r`n")
    ; A finished report teaches Impression this radiologist's style (the hub
    ; keeps findings + impression only, and only while that setting is on).
    StyleLearn(reportText, "proofread")
    if (g_StripHeader)
        reportText := StripPatientHeader(reportText)

    if (StrLen(reportText) < 20) {
        Notify("RadGesture: report too short / nothing copied", 1500)
        return
    }

    Notify("RadGesture: analyzing...", 0)
    apiResponse := CallClaudeAPI(reportText)
    Notify("", 0, true)

    if (apiResponse.error) {
        MsgBox, 16, RadGesture - API error, % apiResponse.error
        return
    }

    if (apiResponse.flags.Length() = 0 && !g_ShowOnEmpty) {
        ; No popup will open, so log immediately
        if (g_LogHistory)
            LogHistorySession(reportText, apiResponse.flags, {})
        Notify("RadGesture: no issues found", 1500)
        return
    }

    ShowProofreadPopup(reportText, apiResponse.flags)
}

StripPatientHeader(t) {
    markers := ["FINDINGS:", "Findings:", "REPORT:", "Report:"
              , "EXAMINATION:", "TECHNIQUE:", "INDICATION:"
              , "HISTORY:", "COMPARISON:", "CLINICAL HISTORY:"]
    earliest := 0
    for i, m in markers {
        p := InStr(t, m)
        if (p && (earliest = 0 || p < earliest))
            earliest := p
    }
    if (earliest > 1)
        return SubStr(t, earliest)
    return t
}

Notify(msg, durationMs := 0, clear := false) {
    global g_ToastHub
    if (clear || msg = "") {
        ToolTip
        if (g_ToastHub)
            KillToast()
        return
    }
    ; Shown by the hub like every other message, when it is running.
    if (HubToast(RegExReplace(msg, "^RadGesture: ", ""), "info", durationMs))
        return
    ToolTip, %msg%
    if (durationMs > 0)
        SetTimer, ClearNotifyTip, % -durationMs
}
ClearNotifyTip:
    ToolTip
return

; ----------------------------------------------------------------------------
; History logging (JSON-Lines: one session per line)
; ----------------------------------------------------------------------------
LogHistorySession(reportText, flags, resolvedMap := "") {
    global HISTORY_PATH, g_Model, g_Sensitivity
    if (resolvedMap = "")
        resolvedMap := {}

    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    resolvedCount := 0
    flagsJson := "["
    for i, f in flags {
        isResolved := resolvedMap.HasKey(i) ? resolvedMap[i] : false
        if (isResolved)
            resolvedCount += 1
        if (i > 1)
            flagsJson .= ","
        flagsJson .= "{""phrase"":" . JsonStr(f.phrase)
                  . ",""reason"":" . JsonStr(f.reason)
                  . ",""replacement"":" . JsonStr(f.replacement)
                  . ",""advice"":" . JsonStr(f.advice)
                  . ",""resolved"":" . (isResolved ? "true" : "false") . "}"
    }
    flagsJson .= "]"

    line := "{""ts"":" . JsonStr(ts)
          . ",""model"":" . JsonStr(g_Model)
          . ",""sensitivity"":" . JsonStr(g_Sensitivity)
          . ",""flag_count"":" . flags.Length()
          . ",""resolved_count"":" . resolvedCount
          . ",""report"":" . JsonStr(reportText)
          . ",""flags"":" . flagsJson . "}`n"

    FileAppend, %line%, %HISTORY_PATH%, UTF-8
}

ShowLastApiCall() {
    reqPath  := g_DataDir . "\RadProofread_lastrequest.txt"
    respPath := g_DataDir . "\RadProofread_lastresponse.txt"
    if !FileExist(reqPath) {
        MsgBox, 4160, RadGesture, No API calls made yet this session.
        return
    }
    Run, notepad.exe "%reqPath%", , , reqPid
    Sleep, 200
    Run, notepad.exe "%respPath%", , , respPid
    ; Started by a program in the background, Notepad would open behind.
    WinWait, ahk_pid %respPid%, , 3
    if !ErrorLevel
        WinActivate, ahk_pid %respPid%
}


ShowHistoryViewer() {
    global HISTORY_PATH
    global IE_HIST  ; ActiveX control variable must be global/static inside a function

    if !FileExist(HISTORY_PATH) {
        MsgBox, 4160, RadGesture, No history yet. Run a proofreading session to start logging.
        return
    }

    ; Read all sessions, newest first
    sessions := []
    Loop, Read, %HISTORY_PATH%
    {
        line := Trim(A_LoopReadLine, " `t`r`n")
        if (line = "")
            continue
        s := ParseHistoryLine(line)
        if (s.ts != "")
            sessions.InsertAt(1, s)
    }

    if (sessions.Length() = 0) {
        MsgBox, 4160, RadGesture, History file is empty.
        return
    }

    ; Build HTML
    bodyHtml := ""
    totalFlags := 0
    for i, s in sessions {
        totalFlags += s.flag_count
        flagsHtml := ""
        if (s.flags.Length() = 0) {
            flagsHtml := "<div class='clean'>&#10003; No issues</div>"
        } else {
            for j, f in s.flags {
                ; Show replacement first if present, fall back to advice for context
                tail := ""
                if (f.replacement != "")
                    tail := " <span class='sg'>&rarr; " . HtmlEscape(f.replacement) . "</span>"
                else if (f.advice != "")
                    tail := " <span class='ad'>(" . HtmlEscape(f.advice) . ")</span>"
                prefix := f.resolved ? "<span class='resolved-mark' title='Marked resolved'>&#10003;</span> " : ""
                cls := f.resolved ? "flag resolved-flag" : "flag"
                flagsHtml .= "<div class='" . cls . "'>"
                    . prefix
                    . "<span class='fp'>" . HtmlEscape(f.phrase) . "</span>"
                    . " &mdash; " . HtmlEscape(f.reason)
                    . tail
                    . "</div>"
            }
        }
        countColor := s.flag_count > 0 ? "#ff6b6b" : "#5cb85c"
        excerpt := SubStr(s.report, 1, 280)
        if (StrLen(s.report) > 280)
            excerpt .= "..."

        countLabel := s.flag_count . " flag" . (s.flag_count = 1 ? "" : "s")
        if (s.resolved_count > 0)
            countLabel .= " &middot; " . s.resolved_count . " resolved"
        bodyHtml .= "<div class='session'>"
            . "<div class='hdr'>"
            . "<span class='ts'>" . HtmlEscape(s.ts) . "</span>"
            . "<span class='meta'>" . HtmlEscape(s.model) . " &middot; " . HtmlEscape(s.sensitivity) . "</span>"
            . "<span class='cnt' style='color:" . countColor . "'>" . countLabel . "</span>"
            . "</div>"
            . "<div class='excerpt'>" . HtmlEscape(excerpt) . "</div>"
            . "<div class='flags'>" . flagsHtml . "</div>"
            . "</div>"
    }

    htmlPath := A_Temp . "\rad_proofread_history.html"
    FileDelete, %htmlPath%

    htmlDoc := "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        . "<meta http-equiv='X-UA-Compatible' content='IE=edge'>"
        . "<style>"
        . "html,body{margin:0;padding:0;background:#1e1e1e;color:#e8e8e8;font-family:Segoe UI,Arial,sans-serif;font-size:13px;}"
        . ".topbar{position:sticky;top:0;background:#1e1e1e;padding:12px 16px;border-bottom:1px solid #333;z-index:10;}"
        . ".topbar input{background:#2a2a2a;color:#e8e8e8;border:1px solid #444;padding:6px 10px;border-radius:3px;width:300px;font-size:13px;font-family:inherit;}"
        . ".topbar .stats{margin-left:14px;color:#888;font-size:12px;}"
        . ".content{padding:8px 16px 20px 16px;}"
        . ".session{background:#252525;border-left:3px solid #444;padding:10px 12px;margin-bottom:10px;border-radius:3px;}"
        . ".hdr{display:flex;align-items:center;gap:14px;margin-bottom:6px;}"
        . ".ts{color:#fff;font-weight:600;font-family:Consolas,monospace;font-size:12px;}"
        . ".meta{color:#888;font-size:11px;}"
        . ".cnt{margin-left:auto;font-weight:600;font-size:12px;}"
        . ".excerpt{color:#bbb;font-family:Consolas,monospace;font-size:11px;line-height:1.5;background:#1a1a1a;padding:6px 8px;border-radius:2px;margin-bottom:6px;white-space:pre-wrap;}"
        . ".flag{padding:3px 0;font-size:12px;}"
        . ".fp{color:#ff8a8a;font-weight:600;font-family:Consolas,monospace;}"
        . ".sg{color:#9ad99a;font-family:Consolas,monospace;}"
        . ".ad{color:#bbb;font-style:italic;font-size:11px;}"
        . ".resolved-mark{color:#5cb85c;font-weight:600;}"
        . ".resolved-flag .fp{text-decoration:line-through;color:#888;}"
        . ".resolved-flag{opacity:.7;}"
        . ".clean{color:#5cb85c;font-size:12px;}"
        . "</style></head><body>"
        . "<div class='topbar'>"
        . "<input type='text' id='filter' placeholder='Filter sessions...' onkeyup='doFilter()'>"
        . "<span class='stats'>" . sessions.Length() . " session" . (sessions.Length() = 1 ? "" : "s")
        . " &middot; " . totalFlags . " total flag" . (totalFlags = 1 ? "" : "s") . "</span>"
        . "</div>"
        . "<div class='content' id='content'>" . bodyHtml . "</div>"
        . "<script>"
        . "function doFilter(){var q=document.getElementById('filter').value.toLowerCase();"
        . "var sess=document.getElementsByClassName('session');"
        . "for(var i=0;i<sess.length;i++){"
        . "var t=sess[i].innerText.toLowerCase();"
        . "sess[i].style.display=(q===''||t.indexOf(q)>=0)?'':'none';}}"
        . "</script>"
        . "</body></html>"

    FileAppend, %htmlDoc%, %htmlPath%, UTF-8

    Gui, HistGui:Destroy
    Gui, HistGui:+AlwaysOnTop +Resize +LastFound -DPIScale
    Gui, HistGui:Color, 1e1e1e
    Gui, HistGui:Margin, 0, 0
    Gui, HistGui:Add, ActiveX, x0 y0 w920 h600 vIE_HIST, Shell.Explorer
    Gui, HistGui:Add, Button, x700 y610 w100 h28 gHistGui_Open, Open Folder
    Gui, HistGui:Add, Button, x810 y610 w100 h28 gHistGui_Close Default, Close

    IE_HIST.Silent := true
    IE_HIST.Navigate("file:///" . StrReplace(htmlPath, "\", "/"))

    Gui, HistGui:Show, w920 h645, RadGesture - History
    WinActivate, RadGesture - History
    return

HistGui_Open:
    Run, explorer.exe /select`,"%HISTORY_PATH%"
return

HistGui_Close:
HistGuiGuiClose:
HistGuiGuiEscape:
    Gui, HistGui:Destroy
return
}

; Parse one history line into a session object
ParseHistoryLine(line) {
    s := { ts: "", model: "", sensitivity: "", flag_count: 0, resolved_count: 0, report: "", flags: [] }
    s.ts          := ExtractJsonString(line, "ts")
    s.model       := ExtractJsonString(line, "model")
    s.sensitivity := ExtractJsonString(line, "sensitivity")
    s.report      := ExtractJsonString(line, "report")
    s.flag_count     := ExtractJsonNumber(line, "flag_count")
    s.resolved_count := ExtractJsonNumber(line, "resolved_count")

    ; Parse the flags array within this line
    flagsKey := """flags"":"
    fp := InStr(line, flagsKey)
    if (fp) {
        rest := SubStr(line, fp + StrLen(flagsKey))
        s.flags := ParseFlagsJson(rest)
    }
    return s
}

; Pull the integer value of "key": <number> from a JSON line.
ExtractJsonNumber(line, key) {
    needle := """" . key . """:"
    p := InStr(line, needle)
    if (!p)
        return 0
    rest := SubStr(line, p + StrLen(needle))
    n := ""
    i := 1
    len := StrLen(rest)
    ; Skip leading whitespace
    while (i <= len) {
        c := SubStr(rest, i, 1)
        if (c = " " || c = "`t")
            i += 1
        else
            break
    }
    while (i <= len) {
        c := SubStr(rest, i, 1)
        if (c >= "0" && c <= "9")
            n .= c
        else
            break
        i += 1
    }
    return n = "" ? 0 : (n + 0)
}

; ----------------------------------------------------------------------------
; API: minimal connectivity test
; ----------------------------------------------------------------------------
PingClaude(apiKey, model) {
    out := { ok: false, error: "" }
    apiKey := CleanApiKey(apiKey)
    if ((why := KeyProblem(apiKey)) != "") {
        out.error := why
        return out
    }
    body := "{""model"":" . JsonStr(model)
        . ",""max_tokens"":64," . ApiExtras("low")
        . """messages"":[{""role"":""user"",""content"":""ping""}]}"
    try {
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        http.Open("POST", API_URL, false)
        http.SetRequestHeader("Content-Type", "application/json")
        http.SetRequestHeader("x-api-key", apiKey)
        http.SetRequestHeader("anthropic-version", API_VERSION)
        http.SetTimeouts(8000, 8000, 15000, 30000)
        http.Send(body)
        st := http.Status
        if (st >= 200 && st < 300) {
            out.ok := true
            return out
        }
        out.error := ApiErrorText(st, http.ResponseText)
    } catch e {
        out.error := "Exception: " . e.Message
    }
    return out
}

TestApiKey() {
    global g_ApiKey, g_Model
    if (!HaveKey()) {
        MsgBox, 4144, RadGesture, No API key yet. Paste it in RadGesture Settings > AI tools.
        return
    }
    res := PingClaude(g_ApiKey, g_Model)
    if (res.ok)
        MsgBox, 4160, RadGesture - API Test, OK. Model "%g_Model%" responded.
    else
        MsgBox, 4112, RadGesture - API Test, % "Failed:`n`n" . res.error
}

; ----------------------------------------------------------------------------
; API: real proofreading call
; ----------------------------------------------------------------------------
CallClaudeAPI(reportText) {
    global g_ApiKey, g_Model, g_MaxTokens, g_Sensitivity

    sensDescriptor := ""
    if (g_Sensitivity = "conservative")
        sensDescriptor := "only flag clear, high-confidence errors"
    else if (g_Sensitivity = "aggressive")
        sensDescriptor := "flag anything that seems off, including subtle issues"
    else
        sensDescriptor := "flag anything you're reasonably confident is wrong; false positives are fine, missed errors are not"

    systemPrompt := ""
    . "You are proofreading a radiology report dictated by a radiologist using PowerScribe speech recognition. "
    . "The dictation engine sometimes produces errors the radiologist needs to catch before signing. "
    . "Your job is to find those errors. Missing real errors is the worst possible outcome -- the radiologist would rather see false positives than miss something."
    . "`n`n## CRITICAL: SECTION-AWARE READING"
    . "`nRadiology reports are organized into anatomic sections like 'Liver:', 'Bowel:', 'Vessels:', 'Bones:', 'Pulmonary:', etc. "
    . "Findings under each section MUST relate to that anatomy. "
    . "Before evaluating any sentence, identify which section header it falls under. "
    . "Then ask: would a radiologist describe THIS finding under THIS section? "
    . "If the section is 'Vessels' and the sentence describes 'cholecystectomy' (a gallbladder surgery), that is a section-mismatch error -- flag it. "
    . "If the section is 'Pulmonary' and the sentence mentions bowel or cholecystectomy, flag it. "
    . "These section-mismatch errors are the MOST IMPORTANT thing you can catch. They happen because the radiologist's templated text didn't get reset between body parts."
    . "`n`n## ERROR CATEGORIES TO FIND"
    . "`n`n**1. Section-context mismatches (HIGHEST PRIORITY).** Content under the wrong anatomic header."
    . "`nExamples (real errors from this user):"
    . "`n- 'Vessels: Status post cholecystectomy.' -- cholecystectomy is biliary, NOT vascular"
    . "`n- 'Pulmonary Incidentals: No bowel oration. Status post cholecystectomy.' -- both bowel and cholecystectomy belong elsewhere, not under Pulmonary"
    . "`n- 'Bones: The gallbladder is normal.' -- gallbladder is not a bone"
    . "`n`n**2. Broken / garbled phrases.** Word fragments, missing words, dropped grammar, or word salad from dictation glitches."
    . "`nExamples (real errors from this user):"
    . "`n- 'No bowel oration' -- 'oration' is wrong; likely 'perforation'"
    . "`n- 'Visua the distal abdomen' -- 'Visua' is a fragment; likely 'Visualization of'"
    . "`n- 'C multilevel noted on the out of 5 cm' -- ungrammatical word salad"
    . "`n- 'image lized portions' -- a word got split across a line break"
    . "`nIf a phrase doesn't parse as fluent English on first read, FLAG IT."
    . "`n`n**3. Word substitutions (including phonetic confusions).** Real words that don't fit the radiology context. Often the engine picked a real word that SOUNDS like the dictated word but doesn't fit clinically."
    . "`nExamples:"
    . "`n- 'hip cholecystectomy' (likely arthroplasty)"
    . "`n- 'liver fracture' (likely rib fracture)"
    . "`n- 'profusion' (likely perfusion)"
    . "`n- 'acute pancreatic cystic lesions' (likely 'A FEW pancreatic cystic lesions' -- 'acute' is a phonetic substitution for 'a few', and 'acute cyst' is clinically odd since cysts are typically chronic findings)"
    . "`n- 'no acute' vs 'an acute' (single-letter changes that flip meaning)"
    . "`n- 'in distinct' vs 'indistinct' (word-split phonetic error)"
    . "`nWhen you see an adjective applied to a noun, ask: 'Is this modifier typical for this noun in radiology?' Be suspicious of 'acute' + chronic-type findings (cysts, sclerosis, atrophy, scarring, granuloma, calcification), or 'chronic' + acute-type findings (active bleed, new infarct). Unusual modifier+noun pairs are a hallmark of phonetic dictation errors."
    . "`n`n**4. Clinical-consistency errors (singular/plural, laterality, disease-location mismatch).** Phrases that are grammatically valid and use real words, but are clinically wrong because they violate medical knowledge. These are subtle -- each sentence reads fine on its own, but a radiologist knows it doesn't make sense."
    . "`n`n   **4a. Singular/plural & laterality.** PAY SPECIAL ATTENTION to plural anatomy when the study covers one side, and laterality contradictions."
    . "`n   Examples:"
    . "`n   - '3 views of the right hands' -- a right-hand series images ONE hand; should be 'right hand' (singular)"
    . "`n   - 'bilateral right knee' -- contradictory: 'bilateral' means both sides, 'right' means one"
    . "`n   - 'AP and lateral views of the chests' -- 'chests' should be 'chest'"
    . "`n   When you see a normally-singular body part rendered plural (hands, chests, pelvises, abdomens, spines, hearts) or laterality contradictions (bilateral + right/left), FLAG IT."
    . "`n`n   **4b. Disease-location mismatch.** A specific finding paired with an anatomic location where that finding does NOT occur. Use your medical knowledge to ask: 'Does this disease/finding actually happen in this place?'"
    . "`n   Examples (real errors from this user and similar):"
    . "`n   - 'FIGO type 3 fibroid in the right sinus' -- fibroids are uterine (FIGO is a UTERINE leiomyoma classification); 'sinus' is wrong. Likely 'fundus', 'cornu', or 'right wall' was intended."
    . "`n   - 'splenic varices in the kidney' -- splenic varices are perisplenic, not renal"
    . "`n   - 'coronary calcification of the femur' -- coronary arteries are cardiac, not skeletal"
    . "`n   - 'subdural hematoma of the liver' -- subdural is intracranial"
    . "`n   - 'BI-RADS 4 lesion in the prostate' -- BI-RADS is for breast, not prostate"
    . "`n   When the same sentence names a SPECIFIC disease/classification (FIGO, BI-RADS, LI-RADS, TI-RADS, PI-RADS, named syndromes, organ-specific entities like 'varices', 'fibroid', 'aneurysm of X') AND a location that's not where that disease lives, FLAG IT."
    . "`n`n## DO NOT FLAG"
    . "`n- Templated phrases ('No acute findings', 'Unremarkable')"
    . "`n- Standard abbreviations (CT, MR, IV, PO, mm, cm)"
    . "`n- Measurements"
    . "`n- Stylistic choices"
    . "`n- Legitimately plural/bilateral anatomy ('bilateral hands', 'both kidneys', 'lungs') when the study genuinely covers both sides"
    . "`n`n## YOUR PROCESS"
    . "`nStep 1: Identify each section header in the report."
    . "`nStep 2: For each sentence, determine which section it belongs under."
    . "`nStep 3: Ask FIVE questions for each sentence:"
    . "`n   (a) Does it parse as fluent English?"
    . "`n   (b) Does its content match the section header?"
    . "`n   (c) Are all words plausible for radiology?"
    . "`n   (d) Singular/plural & laterality OK? (no plural body parts where singular is needed, no bilateral+right/left contradictions)"
    . "`n   (e) Disease-location consistent? If the sentence names a specific disease, classification system, or organ-specific entity, is the named anatomy a place that disease can actually occur?"
    . "`nStep 4: Flag anything failing any check. Sensitivity: " . sensDescriptor . "."
    . "`n`n## OUTPUT"
    . "`nReturn ONLY this JSON, nothing else, no markdown, no explanation:"
    . "`n{""flags"":[{""phrase"":""<exact verbatim substring from the report>"",""reason"":""<which error type and why -- be specific about section if applicable>"",""replacement"":""<clean replacement text only, OR empty string if no direct replacement>"",""advice"":""<optional further guidance, e.g. 'delete this line', 'move to GI section'>""}]}"
    . "`n`nFIELD RULES:"
    . "`n- 'phrase' MUST be an exact case-sensitive substring of the report so the UI can highlight it. Keep phrases short -- the specific bad span, not the whole sentence."
    . "`n- 'replacement' is text the user will literally paste into the report to replace the phrase. It MUST be ONLY the corrected text, NOTHING ELSE. No quotes, no explanations, no '(likely)', no 'remove this'. Examples:"
    . "`n     phrase='oration', replacement='perforation'"
    . "`n     phrase='Visua the distal abdomen', replacement='Visualization of the distal abdomen'"
    . "`n     phrase='hip cholecystectomy', replacement='hip arthroplasty'"
    . "`n  If there is no clean substitution -- e.g. the line should be deleted or moved to another section -- set replacement to empty string."
    . "`n- 'advice' is for cases where there's no simple text replacement. Use it for instructions like 'delete this line' or 'move to abdominal section'. Leave empty if 'replacement' is sufficient."
    . "`n`nIf nothing is wrong, return {""flags"":[]}."

    userMsg := "Report to proofread:`n`n" . reportText

    body := "{"
        . """model"":"      . JsonStr(g_Model) . ","
        . """max_tokens"":" . ApiMaxTokens(g_MaxTokens) . ","
        . ApiExtras("medium")
        . """system"":"     . JsonStr(systemPrompt) . ","
        . """messages"":[{""role"":""user"",""content"":" . JsonStr(userMsg) . "}]"
        . "}"

    result := { flags: [] }

    ; Save the request body for debugging (overwrite each call)
    debugReqPath := g_DataDir . "\RadProofread_lastrequest.txt"
    FileDelete, %debugReqPath%
    FileAppend, %body%, %debugReqPath%, UTF-8

    try {
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        http.Open("POST", API_URL, false)
        http.SetRequestHeader("Content-Type", "application/json")
        http.SetRequestHeader("x-api-key", g_ApiKey)
        http.SetRequestHeader("anthropic-version", API_VERSION)
        http.SetTimeouts(10000, 10000, 30000, 120000)
        http.Send(body)
        status := http.Status
        respText := http.ResponseText
    } catch e {
        result.error := "HTTP exception: " . e.Message
        return result
    }

    ; Save the raw response for debugging (overwrite each call)
    debugRespPath := g_DataDir . "\RadProofread_lastresponse.txt"
    FileDelete, %debugRespPath%
    debugDump := "HTTP " . status . "`n`n=== RAW RESPONSE ===`n" . respText
    FileAppend, %debugDump%, %debugRespPath%, UTF-8

    if (status < 200 || status >= 300) {
        result.error := ApiErrorText(status, respText)
        return result
    }

    assistantText := ExtractAssistantText(respText)
    if (assistantText = "") {
        result.error := "Could not parse assistant text from response.`n`n" . SubStr(respText, 1, 600)
        return result
    }

    cleaned := StripCodeFences(assistantText)
    result.flags := ParseFlagsJson(cleaned)
    result.raw   := assistantText

    ; Append parse-stage info to debug file
    parseInfo := "`n`n=== ASSISTANT TEXT (extracted) ===`n" . assistantText
              . "`n`n=== CLEANED (after StripCodeFences) ===`n" . cleaned
              . "`n`n=== PARSED FLAG COUNT ===`n" . result.flags.Length()
    for i, f in result.flags {
        parseInfo .= "`n`n[" . i . "] phrase=" . f.phrase
                  . "`n    reason=" . f.reason
                  . "`n    replacement=" . f.replacement
                  . "`n    advice=" . f.advice
    }
    FileAppend, %parseInfo%, %debugRespPath%, UTF-8

    ; Sanity check: if assistant text clearly mentions flags but parser found none,
    ; surface this as an error so we don't silently swallow real flags
    if (result.flags.Length() = 0 && InStr(assistantText, """phrase""")) {
        result.error := "PARSE FAILURE: assistant returned flags but parser missed them. Use 'Show Last API Call (debug)' to inspect.`n`nFirst 600 chars of assistant text:`n" . SubStr(assistantText, 1, 600)
    }

    return result
}

; ----------------------------------------------------------------------------
; JSON helpers
; ----------------------------------------------------------------------------
JsonStr(s) {
    ; Standard escapes
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, """", "\""")
    s := StrReplace(s, "`r`n", "\n")
    s := StrReplace(s, "`n", "\n")
    s := StrReplace(s, "`r", "\n")
    s := StrReplace(s, "`t", "\t")
    s := StrReplace(s, Chr(8),  "\b")    ; backspace
    s := StrReplace(s, Chr(12), "\f")    ; form feed
    ; Strip any other control characters (0x00-0x1F) that JSON forbids.
    ; These break the API ("unexpected control character in string") and
    ; never carry meaning in radiology reports. The standard escapes above
    ; have already been converted to multi-char sequences like '\n', so we
    ; won't strip those (we only drop raw single-char control codes here).
    cleaned := ""
    Loop, Parse, s
    {
        if (Asc(A_LoopField) < 32)
            continue
        cleaned .= A_LoopField
    }
    ; Also strip the Unicode line/paragraph separators that some parsers reject
    cleaned := StrReplace(cleaned, Chr(0x2028), " ")
    cleaned := StrReplace(cleaned, Chr(0x2029), " ")
    return """" . cleaned . """"
}

; The models offered in Settings. Anything else saved (an older model that has
; been retired) becomes Sonnet 5.5, so an old INI keeps working.
NormalizeModel(m) {
    for _, ok in ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]
        if (m = ok)
            return ok
    return "claude-sonnet-5-5"
}

; Extra request fields for the 5.5 models: how hard to think. "low" for the
; short tools, "medium" for proofreading. No temperature (rejected).
ApiExtras(effort) {
    return """output_config"":{""effort"":" . JsonStr(effort) . "},"
}

; The model thinks before it writes and the thinking counts toward
; max_tokens, so a small limit (the one-liner's 400) would end the reply
; before any text. Only what is used is billed.
ApiMaxTokens(n) {
    return (n + 0 < 8000) ? 8000 : n + 0
}

; Why a 200 reply had no text, in words.
EmptyReplyReason(respText) {
    if InStr(respText, """stop_reason"":""refusal""")
        return "Claude declined this one (a safety filter). Try rewording, or another model in Settings > AI tools."
    if InStr(respText, """stop_reason"":""max_tokens""")
        return "The reply was cut off before any text (token limit). Raise Max tokens in the AI settings."
    return "Empty reply. Tray -> Show Last API Call (debug) has the raw response."
}

; "Open a program" from the ring, or "Start it with RadGesture" at startup.
; spec = "<mode>|<path>|<options>"; mode: front (start it, or bring its window
; up if it is already open), new (always another copy), start (only if it is
; not running, never brings anything up). An AutoHotkey script that is already
; running is left alone in every mode: a second copy would ask to replace it.
RunProgram(spec) {
    parts := StrSplit(spec, "|", , 3)
    mode := parts[1]
    target := parts[2]
    opts := (parts.Length() >= 3) ? parts[3] : ""
    if (target = "")
        return
    SplitPath, target, runName, runDir, runExt
    if (runExt = "ahk") {
        prevHidden := A_DetectHiddenWindows
        DetectHiddenWindows, On
        SetTitleMatchMode, 2
        found := WinExist(target . " ahk_class AutoHotkey")
        DetectHiddenWindows, %prevHidden%
        if (found) {
            if (mode != "start")
                Notify(runName . " is already running", 1500)
            return
        }
    } else if (runExt = "exe" && mode != "new") {
        Process, Exist, %runName%
        if (ErrorLevel) {
            if (mode = "front" && WinExist("ahk_pid " . ErrorLevel)) {
                WinGet, runMinMax, MinMax
                if (runMinMax = -1)
                    WinRestore  ; only un-minimise: a maximised Epic stays maximised
                WinActivate
            } else if (mode = "front" && WinExist("ahk_exe " . runName)) {
                WinActivate
            }
            return
        }
    }
    if (runDir = "")
        runDir := A_WorkingDir
    try {
        Run, "%target%" %opts%, %runDir%
    } catch e {
        Notify("Could not open " . runName, 2500)
    }
}

; The key as saved right now. Read from the INI before every AI call, not
; only at startup / reload, so a key saved in Settings works at once.
HaveKey() {
    global g_ApiKey, INI_PATH
    IniRead, v, %INI_PATH%, API, ApiKey, %A_Space%
    v := CleanApiKey(v)
    if (v != "")
        g_ApiKey := v
    return g_ApiKey != ""
}

; AI settings live in the hub's Settings window (AI tools page). This
; built-in box is only the fallback for when the hub isn't running.
OpenAiSettings() {
    if (HubRequest("POST", "/open-settings?tab=ai") = "")
        ShowSettingsGui()
}

; What people paste is not always just the key: spaces, a line break, quotes,
; "x-api-key:" from a docs page, or the new key pasted after an old one in a
; masked field. Keep the key itself (the last sk-ant-... if there are two).
CleanApiKey(k) {
    k := RegExReplace(k, "[\s""'<>]")
    k := RegExReplace(k, "i)^x-api-key:")
    p := InStr(k, "sk-ant-", false, 0)
    if (p > 1)
        k := SubStr(k, p)
    return k
}

; "" unless the key is clearly not a Claude API key; any other sk-ant-... key
; goes to Anthropic, which has the final word (an sk-ant-api-only check
; rejected a real sk-ant-usr- key). Same rules as src/common/apikey.js.
KeyProblem(k) {
    if (k = "")
        return "No API key yet. Paste it in Settings > AI tools."
    if (SubStr(k, 1, 10) = "sk-ant-oat")
        return "That is a Claude app login code, not an API key. Make an API key at console.anthropic.com > Settings > API keys (it starts with sk-ant-) and paste that."
    if (SubStr(k, 1, 3) = "sk-" && SubStr(k, 1, 7) != "sk-ant-")
        return "That is an OpenAI (ChatGPT) key, not a Claude key. Make a Claude key at console.anthropic.com > Settings > API keys (it starts with sk-ant-) and paste that."
    if (SubStr(k, 1, 7) != "sk-ant-")
        return "That does not look like an Anthropic API key (they start with sk-ant-). Copy it again from console.anthropic.com > Settings > API keys."
    return ""
}

; An API error in words; the raw reply stays in Show Last API Call (debug).
ApiErrorText(status, body) {
    if (status = 401)
        return "Anthropic says this API key is not valid (HTTP 401). It may be mistyped, cut off, or deleted. Copy a fresh key from console.anthropic.com > Settings > API keys into Settings > AI tools."
    if (status = 403)
        return "This API key is not allowed to do that (HTTP 403). Check the key's workspace and permissions in the Anthropic console."
    if (status = 404)
        return "Anthropic does not know this model for your key (HTTP 404). Pick another model in Settings > AI tools."
    if (status = 429)
        return "Too many requests or out of credit (HTTP 429). Check usage and billing in the Anthropic console, or wait a minute."
    if (status = 529 || status = 503)
        return "Anthropic is busy right now (HTTP " . status . "). Try again in a moment."
    return "HTTP " . status . ":`n" . SubStr(body, 1, 600)
}

ExtractAssistantText(json) {
    pos := InStr(json, """text"":""")
    if (!pos)
        return ""
    start := pos + StrLen("""text"":""")
    out := ""
    i := start
    len := StrLen(json)
    while (i <= len) {
        ch := SubStr(json, i, 1)
        if (ch = "\") {
            esc := SubStr(json, i+1, 1)
            if (esc = "n")
                out .= "`n"
            else if (esc = "r")
                out .= "`r"
            else if (esc = "t")
                out .= "`t"
            else if (esc = """")
                out .= """"
            else if (esc = "\")
                out .= "\"
            else if (esc = "/")
                out .= "/"
            else if (esc = "u") {
                hex := SubStr(json, i+2, 4)
                out .= Chr("0x" . hex)
                i += 4
            } else {
                out .= esc
            }
            i += 2
        } else if (ch = """") {
            return out
        } else {
            out .= ch
            i += 1
        }
    }
    return out
}

; Extract the outermost {...} JSON object from a string, ignoring any
; surrounding prose, markdown fences, etc. Walks the string respecting
; quoted strings so braces inside string values don't confuse it.
ExtractJsonObject(s) {
    len := StrLen(s)
    ; Find first '{'
    objStart := 0
    Loop, %len%
    {
        if (SubStr(s, A_Index, 1) = "{") {
            objStart := A_Index
            break
        }
    }
    if (!objStart)
        return ""
    depth := 0
    inStr := false
    i := objStart
    while (i <= len) {
        c := SubStr(s, i, 1)
        if (inStr) {
            if (c = "\") {
                i += 2
                continue
            } else if (c = """")
                inStr := false
        } else {
            if (c = """")
                inStr := true
            else if (c = "{")
                depth += 1
            else if (c = "}") {
                depth -= 1
                if (depth = 0)
                    return SubStr(s, objStart, i - objStart + 1)
            }
        }
        i += 1
    }
    return ""
}

StripCodeFences(s) {
    ; Use the robust JSON object extractor instead of trying to detect fences
    obj := ExtractJsonObject(s)
    if (obj != "")
        return obj
    ; Fallback: just trim
    return Trim(s, " `t`r`n")
}

ParseFlagsJson(s) {
    flags := []
    ; Look for "flags":[ specifically, then fall back to first [ if not found
    flagsKey := """flags"":"
    keyPos := InStr(s, flagsKey)
    if (keyPos) {
        arrStart := InStr(s, "[", false, keyPos + StrLen(flagsKey))
    } else {
        arrStart := InStr(s, "[")
    }
    if (!arrStart)
        return flags
    arrEnd := FindMatchingBracket(s, arrStart)
    if (!arrEnd)
        return flags
    arr := SubStr(s, arrStart + 1, arrEnd - arrStart - 1)

    i := 1
    len := StrLen(arr)
    while (i <= len) {
        while (i <= len) {
            c := SubStr(arr, i, 1)
            if (c = " " || c = "`t" || c = "`r" || c = "`n" || c = ",")
                i += 1
            else
                break
        }
        if (i > len)
            break
        if (SubStr(arr, i, 1) != "{")
            break

        depth := 0
        inStr := false
        objStart := i
        while (i <= len) {
            c := SubStr(arr, i, 1)
            if (inStr) {
                if (c = "\") {
                    i += 2
                    continue
                } else if (c = """")
                    inStr := false
            } else {
                if (c = """")
                    inStr := true
                else if (c = "{")
                    depth += 1
                else if (c = "}") {
                    depth -= 1
                    if (depth = 0) {
                        objText := SubStr(arr, objStart, i - objStart + 1)
                        flag := ParseFlagObject(objText)
                        if (flag.phrase != "")
                            flags.Push(flag)
                        i += 1
                        break
                    }
                }
            }
            i += 1
        }
    }
    return flags
}

FindMatchingBracket(s, openPos) {
    depth := 0
    inStr := false
    i := openPos
    len := StrLen(s)
    while (i <= len) {
        c := SubStr(s, i, 1)
        if (inStr) {
            if (c = "\") {
                i += 2
                continue
            } else if (c = """")
                inStr := false
        } else {
            if (c = """")
                inStr := true
            else if (c = "[")
                depth += 1
            else if (c = "]") {
                depth -= 1
                if (depth = 0)
                    return i
            }
        }
        i += 1
    }
    return 0
}

ParseFlagObject(obj) {
    out := { phrase: "", reason: "", replacement: "", advice: "", resolved: false }
    out.phrase      := ExtractJsonString(obj, "phrase")
    out.reason      := ExtractJsonString(obj, "reason")
    out.replacement := ExtractJsonString(obj, "replacement")
    out.advice      := ExtractJsonString(obj, "advice")
    ; resolved is a JSON boolean, not a string -- look for "resolved":true
    if (InStr(obj, """resolved"":true"))
        out.resolved := true
    ; Backward compat: if model returned old "suggestion" field, treat it as advice
    if (out.replacement = "" && out.advice = "") {
        legacy := ExtractJsonString(obj, "suggestion")
        if (legacy != "")
            out.advice := legacy
    }
    return out
}

ExtractJsonString(obj, key) {
    ; Find "key":  -- the value-opening quote may have whitespace before it
    needle := """" . key . """:"
    pos := InStr(obj, needle)
    if (!pos)
        return ""
    ; Skip past the key+colon, then skip whitespace, then expect opening quote
    i := pos + StrLen(needle)
    len := StrLen(obj)
    while (i <= len) {
        c := SubStr(obj, i, 1)
        if (c = " " || c = "`t" || c = "`r" || c = "`n")
            i += 1
        else
            break
    }
    if (SubStr(obj, i, 1) != """")
        return ""  ; value isn't a string (could be number/null/etc -- not our case)
    i += 1  ; advance past opening quote

    out := ""
    while (i <= len) {
        ch := SubStr(obj, i, 1)
        if (ch = "\") {
            esc := SubStr(obj, i+1, 1)
            if (esc = "n")
                out .= "`n"
            else if (esc = """")
                out .= """"
            else if (esc = "\")
                out .= "\"
            else if (esc = "t")
                out .= "`t"
            else if (esc = "/")
                out .= "/"
            else
                out .= esc
            i += 2
        } else if (ch = """") {
            return out
        } else {
            out .= ch
            i += 1
        }
    }
    return out
}

; ----------------------------------------------------------------------------
; Results popup (HTML / IE ActiveX) -- with interactive flag actions
; ----------------------------------------------------------------------------
; (The proofread window's globals are set up at the top of the script: an
; assignment down here, after the start-up section, would never run.)

ShowProofreadPopup(reportText, flags) {
    global IE  ; ActiveX control variable must be global/static inside a function
    global g_PopupFlags, g_PopupHwnd, g_ResolvedMap, g_PopupReport

    g_PopupFlags := flags
    g_ResolvedMap := {}  ; fresh for each popup
    g_PopupReport := reportText
    ; Capture the window we copied the report from -- used for "Find in report"
    g_PopupHwnd := WinExist("A")  ; current active window (PowerScribe)

    ; RadGesture's own window shows the results when it is running; this
    ; built-in window is the fallback.
    if (ProofreadToHub(reportText, flags))
        return

    htmlReport := BuildHighlightedHtml(reportText, flags)

    flagListHtml := ""
    if (flags.Length() = 0) {
        flagListHtml := "<div class='nope'>&#10003; No likely dictation errors detected.</div>"
    } else {
        for i, f in flags {
            hasReplacement := (f.replacement != "")
            hasAdvice      := (f.advice != "")
            findLabel := hasReplacement ? "Find &amp; prep replace" : "Find in report"

            ; Build context snippet showing the phrase in its surrounding text.
            ; This helps the user locate the phrase visually without needing
            ; to use the Find feature.
            ctxHtml := BuildContextSnippet(reportText, f.phrase, 40)

            flagListHtml .= "<div class='flag' id='flag-" . i . "' data-idx='" . i . "' onclick=""scrollToHl(" . i . ")"">"
                . "<div class='flag-head'>"
                .   "<input type='checkbox' class='flag-check' id='chk-" . i . "' onclick=""toggleResolved(event," . i . ")"">"
                .   "<label for='chk-" . i . "' class='flag-phrase' onclick=""event.stopPropagation()"">" . HtmlEscape(f.phrase) . "</label>"
                . "</div>"
                . (ctxHtml != "" ? "<div class='flag-context'>" . ctxHtml . "</div>" : "")
                . "<div class='flag-reason'>" . HtmlEscape(f.reason) . "</div>"
                . (hasReplacement ? "<div class='flag-sugg'>&rarr; " . HtmlEscape(f.replacement) . "</div>" : "")
                . (hasAdvice      ? "<div class='flag-advice'>" . HtmlEscape(f.advice) . "</div>" : "")
                . "<div class='flag-actions'>"
                .   "<button class='btn-find' onclick=""act(event,'find'," . i . ")"">" . findLabel . "</button>"
                .   (hasReplacement ? "<button class='btn-copy' onclick=""act(event,'copy'," . i . ")"">Copy replacement</button>" : "")
                . "</div>"
                . "</div>"
        }
    }

    flagCount := flags.Length()
    countLabel := flagCount . " flag" . (flagCount = 1 ? "" : "s")
    countColor := flagCount > 0 ? "#ff6b6b" : "#5cb85c"

    htmlPath := A_Temp . "\rad_proofread.html"
    FileDelete, %htmlPath%

    htmlDoc := "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        . "<meta http-equiv='X-UA-Compatible' content='IE=edge'>"
        . "<style>"
        . "html,body{margin:0;padding:0;background:#1e1e1e;color:#e8e8e8;font-family:Segoe UI,Arial,sans-serif;font-size:13px;}"
        . ".wrap{display:flex;height:100vh;}"
        . ".left{flex:1.4;padding:14px 16px;overflow-y:auto;border-right:1px solid #333;}"
        . ".right{flex:1;padding:14px 16px;overflow-y:auto;background:#181818;}"
        . "h2{font-size:13px;font-weight:600;color:#aaa;margin:0 0 10px 0;letter-spacing:.5px;text-transform:uppercase;}"
        . ".count{color:" . countColor . ";}"
        . ".report{white-space:pre-wrap;line-height:1.55;font-family:Consolas,Menlo,monospace;font-size:13px;}"
        . ".hl{background:#5a1a1a;color:#ffd0d0;border-bottom:2px solid #ff4d4d;padding:1px 2px;border-radius:2px;}"
        . ".hl.active{background:#8a2424;color:#fff;box-shadow:0 0 0 2px #ff4d4d;}"
        . ".flag{background:#2a1414;border-left:3px solid #ff4d4d;padding:8px 10px;margin-bottom:8px;border-radius:3px;cursor:pointer;transition:background .12s,opacity .15s;}"
        . ".flag:hover{background:#371818;}"
        . ".flag.sel{background:#3d1c1c;border-left-color:#ff8a8a;}"
        . ".flag.resolved{opacity:.45;border-left-color:#5cb85c;background:#1a201a;}"
        . ".flag.resolved:hover{opacity:.7;background:#212821;}"
        . ".flag.resolved .flag-phrase{text-decoration:line-through;color:#888;}"
        . ".flag.resolved .flag-context,.flag.resolved .flag-reason,.flag.resolved .flag-sugg,.flag.resolved .flag-advice{text-decoration:line-through;}"
        . "body.hide-resolved .flag.resolved{display:none;}"
        . ".flag-head{display:flex;align-items:center;gap:8px;margin-bottom:3px;}"
        . ".flag-check{margin:0;cursor:pointer;width:14px;height:14px;flex-shrink:0;}"
        . ".flag-phrase{color:#ff8a8a;font-weight:600;font-family:Consolas,monospace;margin:0;cursor:pointer;flex:1;}"
        . ".flag-context{color:#888;font-size:11px;font-family:Consolas,monospace;background:#161616;padding:5px 7px;border-radius:2px;margin-bottom:6px;line-height:1.45;white-space:normal;}"
        . ".ctx-mark{background:#5a1a1a;color:#ffd0d0;padding:0 2px;border-radius:2px;font-weight:600;}"
        . ".hl.resolved{background:#2a3a2a;color:#7a8a7a;border-bottom-color:#5cb85c;text-decoration:line-through;}"
        . ".flag-reason{color:#ddd;font-size:12px;margin-bottom:3px;}"
        . ".flag-sugg{color:#9ad99a;font-size:12px;font-family:Consolas,monospace;margin-bottom:6px;}"
        . ".flag-advice{color:#c9c9c9;font-size:11px;font-style:italic;margin-bottom:6px;}"
        . ".flag-actions{display:flex;gap:6px;margin-top:6px;}"
        . ".flag-actions button{background:#333;color:#e8e8e8;border:1px solid #555;padding:4px 9px;border-radius:3px;font-size:11px;font-family:inherit;cursor:pointer;}"
        . ".flag-actions button:hover{background:#444;border-color:#777;}"
        . ".btn-copy{background:#2d4a2d !important;border-color:#3a5a3a !important;}"
        . ".btn-copy:hover{background:#3a5a3a !important;}"
        . ".btn-find{background:#3a3a4a !important;border-color:#4a4a5a !important;}"
        . ".btn-find:hover{background:#4a4a5a !important;}"
        . ".nope{color:#5cb85c;font-size:14px;padding:12px 0;}"
        . ".rt-head{display:flex;align-items:center;gap:10px;margin:0 0 10px 0;}"
        . ".rt-head h2{margin:0;flex:1;}"
        . ".rt-toggle{font-size:11px;color:#bbb;cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;}"
        . ".rt-toggle input{margin:0;cursor:pointer;}"
        . "#toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#2d4a2d;color:#dcefdc;padding:8px 16px;border-radius:4px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none;border:1px solid #3a5a3a;}"
        . "#toast.show{opacity:1;}"
        . "</style></head><body>"
        . "<div class='wrap'>"
        . "<div class='left'><h2>Report <span class='count' id='left-count'>(" . countLabel . ")</span></h2>"
        . "<div class='report' id='report'>" . htmlReport . "</div></div>"
        . "<div class='right'>"
        . "<div class='rt-head'><h2>Findings <span id='right-count' class='count'>(" . countLabel . ")</span></h2>"
        . (flagCount > 0 ? "<label class='rt-toggle'><input type='checkbox' id='hide-resolved' onclick='toggleHideResolved()'> Hide resolved</label>" : "")
        . "</div>"
        . flagListHtml . "</div>"
        . "</div>"
        . "<div id='toast'></div>"
        . "<script>"
        . "var totalFlags=" . flagCount . ";"
        . "function act(e,a,i){e.stopPropagation();window.location.href='rp:'+a+':'+i;}"
        . "function scrollToHl(i){"
        .   "var fls=document.getElementsByClassName('flag');"
        .   "for(var k=0;k<fls.length;k++)fls[k].classList.remove('sel');"
        .   "var f=document.getElementById('flag-'+i);if(f)f.classList.add('sel');"
        .   "var hls=document.querySelectorAll('.hl');"
        .   "for(var k=0;k<hls.length;k++)hls[k].classList.remove('active');"
        .   "var idx=i-1;if(hls[idx]){hls[idx].classList.add('active');hls[idx].scrollIntoView({block:'center'});}"
        . "}"
        . "function toggleResolved(e,i){"
        .   "e.stopPropagation();"
        .   "var card=document.getElementById('flag-'+i);"
        .   "var chk=document.getElementById('chk-'+i);"
        .   "var hls=document.querySelectorAll('.hl');var hl=hls[i-1];"
        .   "if(chk.checked){card.classList.add('resolved');if(hl)hl.classList.add('resolved');}"
        .   "else{card.classList.remove('resolved');if(hl)hl.classList.remove('resolved');}"
        .   "updateCounts();"
        .   "window.location.href='rp:resolve:'+i+':'+(chk.checked?'1':'0');"
        . "}"
        . "function updateCounts(){"
        .   "var resolved=document.querySelectorAll('.flag.resolved').length;"
        .   "var remaining=totalFlags-resolved;"
        .   "var label=remaining===totalFlags?(totalFlags+' flag'+(totalFlags===1?'':'s')):(remaining+' of '+totalFlags+' remaining');"
        .   "document.getElementById('left-count').textContent='('+label+')';"
        .   "document.getElementById('right-count').textContent='('+label+')';"
        . "}"
        . "function toggleHideResolved(){"
        .   "var on=document.getElementById('hide-resolved').checked;"
        .   "document.body.classList.toggle('hide-resolved',on);"
        . "}"
        . "function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},1600);}"
        . "window.rpToast=showToast;"
        . "</script>"
        . "</body></html>"

    FileAppend, %htmlDoc%, %htmlPath%, UTF-8

    Gui, ProofGui:Destroy
    Gui, ProofGui:+AlwaysOnTop +Resize +LastFound -DPIScale
    Gui, ProofGui:Color, 1e1e1e
    Gui, ProofGui:Margin, 0, 0
    Gui, ProofGui:Add, ActiveX, x0 y0 w900 h560 vIE, Shell.Explorer
    Gui, ProofGui:Add, Button, x780 y570 w100 h28 gProofGui_Close Default, Close

    IE.Silent := true
    IE.Navigate("file:///" . StrReplace(htmlPath, "\", "/"))

    ; Wire up the JS->AHK bridge: intercept rp:action:index navigations
    ComObjConnect(IE, "IE_")

    title := "RadGesture - " . countLabel
    Gui, ProofGui:Show, w900 h605, %title%
    return

ProofGui_Close:
ProofGuiGuiClose:
ProofGuiGuiEscape:
    try ComObjConnect(IE)  ; disconnect events
    Gui, ProofGui:Destroy
    ; Log the session now (so resolved state is captured) -- only if there
    ; were any flags. Empty-flag sessions were logged at API time.
    if (g_LogHistory && g_PopupFlags.Length() > 0)
        LogHistorySession(g_PopupReport, g_PopupFlags, g_ResolvedMap)
return
}

; Hands the results to RadGesture's proofread window. True when it shows them.
ProofreadToHub(reportText, flags) {
    global g_ProofHub, g_ProofSeq, g_ProofSessions, g_RingOpen, g_HubLastErr
    seq := g_ProofSeq + 1
    json := "{""seq"":" . seq . ",""report"":" . JsonAscii(reportText) . ",""flags"":["
    for i, f in flags
        json .= (i > 1 ? "," : "") . "{""phrase"":" . JsonAscii(f.phrase) . ",""reason"":" . JsonAscii(f.reason)
            . ",""replacement"":" . JsonAscii(f.replacement) . ",""advice"":" . JsonAscii(f.advice) . "}"
    json .= "]}"
    ; Generous: on a busy workstation the window can take a few seconds.
    resp := HubRequest("POST", "/proofread", 8000, json)
    if (resp != "ok") {
        ; Say why in Settings > Status (recent activity), then fall back.
        why := (resp != "") ? resp : g_HubLastErr
        why := RegExReplace(SubStr(why, 1, 80), "[^A-Za-z0-9._-]+", "-")
        HubRequest("POST", "/done?action=proof-fallback:" . why)
        return false
    }
    g_ProofSeq := seq
    g_ProofSessions[seq] := { report: reportText, flags: flags }
    g_ProofHub := true
    ; Answer the window's buttons quickly while it is open.
    if (!g_RingOpen)
        SetTimer, HubPoll, 150
    return true
}

ProofDemo() {
    tab := A_Tab
    rpt := "EXAMINATION: CT CHEST" . "`r`n`r`n" . "FINDINGS:" . "`r`n"
        . "Lungs:" . tab . "A 6 " . Chr(215) . " 4 mm nodule in the left upper lobe. SUV max 1.9, 4.4 " . Chr(181) . "Ci." . "`r`n"
        . "Pleura: Small right plural effusion " . Chr(8212) . " unchanged. " . Chr(8220) . "Stable" . Chr(8221) . "." . "`r`n`r`n"
        . "IMPRESSION:" . "`r`n" . "1. No acute findings."
    flags := []
    flags.Push({ phrase: "plural effusion", reason: "Spelling: pleural.", replacement: "pleural effusion", advice: "" })
    flags.Push({ phrase: "4.4 " . Chr(181) . "Ci", reason: "Unit looks wrong for a dose.", replacement: "4.4 mCi", advice: "Check the dose." })
    ShowProofreadPopup(rpt, flags)
}

; JsonStr with every non-ASCII character as \uXXXX, so the body is plain
; ASCII whatever encoding the request goes out in.
JsonAscii(s) {
    s := JsonStr(s)
    out := ""
    Loop, Parse, s
    {
        c := Ord(A_LoopField)
        out .= (c > 126) ? Format("\u{:04x}", c) : A_LoopField
    }
    return out
}

; A message from RadGesture's proofread window, by the ring's action queue:
;   proof:find:<seq>:<i>        find finding <i> in PowerScribe
;   proof:closed:<seq>:<i,i>    the window closed; these were ticked off
ProofHubAction(a) {
    global g_ProofHub, g_ProofSeq, g_ProofSessions, g_LogHistory, g_RingOpen
    parts := StrSplit(a, ":")
    seq := parts[3] + 0
    if (parts[2] = "find") {
        if (seq = g_ProofSeq)
            HandleFlagAction("find", parts[4] + 0)
        return
    }
    if (parts[2] != "closed")
        return
    sess := g_ProofSessions[seq]
    g_ProofSessions.Delete(seq)
    if (seq = g_ProofSeq) {
        g_ProofHub := false
        HubPollRefresh()
    }
    if (!IsObject(sess) || !g_LogHistory || sess.flags.Length() = 0)
        return
    resolved := {}
    Loop, Parse, % parts[4], `,
        if (A_LoopField != "")
            resolved[A_LoopField + 0] := true
    LogHistorySession(sess.report, sess.flags, resolved)
}

; ----------------------------------------------------------------------------
; IE event handler: intercept "rp:" pseudo-URL navigations from button clicks
; URL formats:
;   rp:find:<idx>         -- run Find action on flag <idx>
;   rp:copy:<idx>         -- copy replacement of flag <idx>
;   rp:resolve:<idx>:<0|1> -- mark flag <idx> resolved (1) or unresolved (0)
; ----------------------------------------------------------------------------
IE_BeforeNavigate2(ieObj, ByRef url, flags, target, postData, headers, ByRef cancel) {
    if (SubStr(url, 1, 3) != "rp:")
        return
    cancel := true  ; don't actually navigate

    rest := SubStr(url, 4)
    ; Split on colons
    parts := StrSplit(rest, ":")
    if (parts.Length() < 2)
        return
    action := parts[1]
    idx    := parts[2] + 0
    arg    := parts.Length() >= 3 ? parts[3] : ""

    HandleFlagAction(action, idx, arg)
}

HandleFlagAction(action, idx, arg := "") {
    global g_PopupFlags, g_PopupHwnd, g_FindBusy, g_ResolvedMap, IE
    if (idx < 1 || idx > g_PopupFlags.Length())
        return
    f := g_PopupFlags[idx]

    if (action = "copy") {
        if (f.replacement = "") {
            JsToast("No replacement text for this flag (see advice)")
            return
        }
        Clipboard := f.replacement
        JsToast("Copied replacement: " . StrLen(f.replacement) . " chars - paste with Ctrl+V")
    } else if (action = "find") {
        ; Re-entrancy guard: ignore clicks while a Find action is mid-flight.
        if (g_FindBusy) {
            JsToast("Working on previous find -- please wait")
            return
        }
        if (!g_PopupHwnd || !WinExist("ahk_id " . g_PopupHwnd)) {
            JsToast("Source window not found")
            return
        }

        g_FindBusy := true
        DoFindInSource(f.phrase, f.replacement)
        g_FindBusy := false
    } else if (action = "resolve") {
        ; Track resolved state so that when the popup closes we can log it.
        g_ResolvedMap[idx] := (arg = "1")
    }
}

; ----------------------------------------------------------------------------
; Find/Replace in PowerScribe
; ----------------------------------------------------------------------------
; Architecture (per investigation of PowerScribe 360 v11.0):
;   - Find/Replace dialog opens via Ctrl+H (NOT Ctrl+F)
;   - Dialog title is exactly "Find and Replace"
;   - Dialog has 2 edit controls: top = "Find What", bottom = "Replace With"
;
; Strategy (safe version, after RichEdit message crashes in earlier versions):
;   1. Activate PowerScribe main window.
;   2. Close any pre-existing Find dialog so we don't operate on a stale one.
;   3. Send Ctrl+H to open Find and Replace.
;   4. Wait for the dialog window to exist.
;   5. ControlSetText directly into the Find What edit (top, by Y position).
;   6. If we have a replacement, ControlSetText into the Replace With edit.
;   7. Activate the dialog so it's foreground; user clicks Replace themselves.
;
; CRITICAL: this function sends NO Win32 messages to PowerScribe's report
; editor. Previous versions used EM_FINDTEXTEX, EM_EXSETSEL, EM_SETSEL, and
; EM_SCROLLCARET on the report's RichEdit -- this crashed PowerScribe,
; presumably because the WinForms RichTextBox wrapper desynchronizes when
; you bypass it with raw Win32 messages.
;
; This approach eliminates every prior bug class:
;   - No clipboard involvement -> can't paste the report into a search box
;   - No keystrokes into dialog -> can't race with focus, no double-paste
;   - No raw messages to the editor -> can't crash PowerScribe
; ----------------------------------------------------------------------------
DoFindInSource(phrase, replacement := "") {
    global g_PopupHwnd, g_ProofHub

    ; --- Step 1: Activate PowerScribe main window ---
    WinActivate, ahk_id %g_PopupHwnd%
    WinWaitActive, ahk_id %g_PopupHwnd%, , 1
    if (ErrorLevel) {
        JsToast("Could not activate PowerScribe")
        return
    }

    ; --- Step 2: Close any pre-existing Find and Replace dialog ---
    ; A stale dialog from a previous action will cause our ControlSetText
    ; to potentially target the wrong window, or our Ctrl+H to be ignored.
    if WinExist("Find and Replace") {
        WinClose, Find and Replace
        WinWaitClose, Find and Replace, , 1
        Sleep, 80
        WinActivate, ahk_id %g_PopupHwnd%
        WinWaitActive, ahk_id %g_PopupHwnd%, , 1
    }

    ; --- Step 3: Open Find and Replace dialog ---
    ; We do NOT send ANY messages to PowerScribe's RichEdit editor.
    ; (Doing so crashed PowerScribe in previous versions of this script.)
    ; We just open the dialog and write directly into ITS edit controls.
    ; The dialog is a separate window and is safe to manipulate.
    Send, ^h

    ; --- Step 4: Wait for the dialog to actually exist ---
    WinWait, Find and Replace, , 3
    if (ErrorLevel) {
        JsToast("Find dialog did not open within 3 seconds")
        return
    }
    WinGet, dlgHwnd, ID, Find and Replace

    ; Stabilization: let the dialog finish constructing its child controls
    Sleep, 150

    ; --- Step 5: Identify the Find What and Replace With edit controls ---
    ; Per inspection of PowerScribe 360 v11.0:
    ;   - There are exactly 2 WindowsForms10.EDIT controls in the dialog
    ;   - Top one (lower Y) = "Find What"
    ;   - Bottom one (higher Y) = "Replace With"
    findWhatCtrl   := FindEditByYPosition(dlgHwnd, "top")
    replaceWithCtrl := FindEditByYPosition(dlgHwnd, "bottom")

    if (!findWhatCtrl) {
        JsToast("Could not find the search box in dialog")
        return
    }

    ; --- Step 6: Write the phrase into Find What ---
    ; ControlSetText writes directly to a control's text buffer. It does
    ; not involve keystrokes, focus, or clipboard. It's the standard,
    ; safe way to populate a dialog field.
    ControlSetText, , %phrase%, ahk_id %findWhatCtrl%

    ; --- Step 7: If we have a replacement, write it into Replace With ---
    if (replacement != "" && replaceWithCtrl) {
        ControlSetText, , %replacement%, ahk_id %replaceWithCtrl%
    }

    ; --- Step 8: Make sure the dialog is foreground and the user can act ---
    WinActivate, ahk_id %dlgHwnd%

    JsToast(replacement != "" ? "Ready: Find What and Replace With filled" : "Ready: Find What filled")
    Sleep, 150
    if (!g_ProofHub)
        Gui, ProofGui:Show, NoActivate
}

; ----------------------------------------------------------------------------
; Find an EDIT control by its Y position within a dialog.
; Returns the HWND of the topmost or bottommost EDIT control.
; ----------------------------------------------------------------------------
FindEditByYPosition(dlgHwnd, which) {
    WinGet, ctrlList, ControlList, ahk_id %dlgHwnd%
    bestHwnd := 0
    bestY    := (which = "top") ? 99999 : -1
    Loop, Parse, ctrlList, `n
    {
        ctrlName := A_LoopField
        if !InStr(ctrlName, ".EDIT.")
            continue
        ControlGetPos, , cy, , , %ctrlName%, ahk_id %dlgHwnd%
        if (which = "top" && cy < bestY) || (which = "bottom" && cy > bestY) {
            bestY := cy
            ControlGet, h, Hwnd, , %ctrlName%, ahk_id %dlgHwnd%
            bestHwnd := h
        }
    }
    return bestHwnd
}

; ----------------------------------------------------------------------------
; (Removed: FindReportEditor, FindReplaceWithEdit, RichEditFindText,
;  RichEditSelect. Previous versions of this script sent EM_FINDTEXTEX,
;  EM_EXSETSEL, EM_SETSEL, and EM_SCROLLCARET messages directly to
;  PowerScribe's RichEdit. This crashed PowerScribe -- presumably because
;  the WinForms RichTextBox wrapper desynchronizes when you bypass it.
;  The current DoFindInSource above does NOT send ANY messages to the
;  editor; it only manipulates the Find and Replace dialog's own controls.)
; ----------------------------------------------------------------------------

; Inject a toast call into the popup's JS
JsToast(msg) {
    global IE, g_ProofHub
    if (g_ProofHub) {
        HubRequest("POST", "/proofread-toast", 400, msg)
        return
    }
    try {
        ; Escape the message for JS string literal
        m := StrReplace(msg, "\", "\\")
        m := StrReplace(m, "'", "\'")
        m := StrReplace(m, "`r", "")
        m := StrReplace(m, "`n", " ")
        IE.document.parentWindow.execScript("rpToast('" . m . "')", "JavaScript")
    }
}


; ----------------------------------------------------------------------------
; Build an HTML snippet showing the phrase surrounded by context.
; Returns something like:
;     "...Pulmonary Incidentals: No <mark>bowel obstruction</mark>\nNone..."
; with the phrase wrapped in a highlight span and surrounding chars in muted
; gray. Tries to break at word boundaries to avoid cutting words mid-letter.
; Returns "" if the phrase isn't found in the report.
; ----------------------------------------------------------------------------
BuildContextSnippet(reportText, phrase, contextChars) {
    if (phrase = "")
        return ""
    pos := InStr(reportText, phrase, false)  ; case-insensitive
    if (!pos)
        return ""

    phraseLen := StrLen(phrase)
    reportLen := StrLen(reportText)

    ; Compute raw window
    startPos := pos - contextChars
    endPos   := pos + phraseLen + contextChars - 1

    leftTruncated  := (startPos < 1)
    rightTruncated := (endPos > reportLen)
    if (startPos < 1)
        startPos := 1
    if (endPos > reportLen)
        endPos := reportLen

    ; Try to extend the start back to a word boundary (or use space found)
    if (leftTruncated = false && startPos > 1) {
        ; Walk left up to 15 chars looking for a space/newline
        scanLimit := startPos - 15
        if (scanLimit < 1)
            scanLimit := 1
        i := startPos
        while (i > scanLimit) {
            c := SubStr(reportText, i - 1, 1)
            if (c = " " || c = "`n" || c = "`r" || c = "`t") {
                startPos := i
                break
            }
            i -= 1
        }
    }
    ; Try to extend the end forward to a word boundary
    if (rightTruncated = false && endPos < reportLen) {
        scanLimit := endPos + 15
        if (scanLimit > reportLen)
            scanLimit := reportLen
        i := endPos
        while (i < scanLimit) {
            c := SubStr(reportText, i + 1, 1)
            if (c = " " || c = "`n" || c = "`r" || c = "`t") {
                endPos := i
                break
            }
            i += 1
        }
    }

    ; Slice into three parts: before, phrase, after
    beforeText := SubStr(reportText, startPos, pos - startPos)
    phraseText := SubStr(reportText, pos, phraseLen)
    afterText  := SubStr(reportText, pos + phraseLen, endPos - (pos + phraseLen) + 1)

    ; Convert newlines into visual line breaks but keep them subtle
    out := ""
    if (leftTruncated)
        out .= "&hellip;"
    out .= HtmlEscapeKeepNewlines(beforeText)
    out .= "<mark class='ctx-mark'>" . HtmlEscape(phraseText) . "</mark>"
    out .= HtmlEscapeKeepNewlines(afterText)
    if (rightTruncated)
        out .= "&hellip;"
    return out
}

; HTML-escape a string and convert newlines to <br> for display in flowing text.
HtmlEscapeKeepNewlines(s) {
    s := HtmlEscape(s)
    s := StrReplace(s, "`r`n", "<br>")
    s := StrReplace(s, "`n", "<br>")
    s := StrReplace(s, "`r", "<br>")
    return s
}


BuildHighlightedHtml(reportText, flags) {
    ranges := []
    for i, f in flags {
        if (f.phrase = "")
            continue
        pos := InStr(reportText, f.phrase, false)
        if (pos)
            ranges.Push({ start: pos, len: StrLen(f.phrase) })
    }
    SortRangesAsc(ranges)
    cleaned := []
    lastEnd := 0
    for i, r in ranges {
        if (r.start > lastEnd) {
            cleaned.Push(r)
            lastEnd := r.start + r.len - 1
        }
    }
    out := ""
    cursor := 1
    len := StrLen(reportText)
    for i, r in cleaned {
        if (r.start > cursor)
            out .= HtmlEscape(SubStr(reportText, cursor, r.start - cursor))
        out .= "<span class='hl'>" . HtmlEscape(SubStr(reportText, r.start, r.len)) . "</span>"
        cursor := r.start + r.len
    }
    if (cursor <= len)
        out .= HtmlEscape(SubStr(reportText, cursor))
    return out
}

SortRangesAsc(ByRef arr) {
    n := arr.Length()
    if (n < 2)
        return
    Loop, % n - 1 {
        i := A_Index + 1
        cur := arr[i]
        j := i - 1
        while (j >= 1 && arr[j].start > cur.start) {
            arr[j+1] := arr[j]
            j -= 1
        }
        arr[j+1] := cur
    }
}

HtmlEscape(s) {
    s := StrReplace(s, "&", "&amp;")
    s := StrReplace(s, "<", "&lt;")
    s := StrReplace(s, ">", "&gt;")
    s := StrReplace(s, """", "&quot;")
    return s
}

; ============================================================================
; PRIOR CHECKLIST MODE
; ----------------------------------------------------------------------------
; Collect one or more prior reports into a "bin", then ask Claude for a very
; short list of things to double-check on the exam being read now: known
; findings to follow up, measurements to compare, recommendations made,
; incidentals mentioned. Each line names the prior it came from (P1, P2...).
;
; Capture: priors open in PACS, where Ctrl+A / Ctrl+C may not select just the
; report. So by default "+ Add" takes whatever text is already on the
; clipboard (select the report in PACS, right-click -> Copy, then + Add).
; [Priors] CaptureMode=selectall makes + Add press Ctrl+A, Ctrl+C itself, the
; way Ctrl+Alt+Q does in PowerScribe.
;
; Focus: both windows are WS_EX_NOACTIVATE (+E0x08000000) and always shown
; with NoActivate. Clicking their
; buttons leaves the keyboard where it was, so dictation never lands in the
; wrong window. For the same reason there is no MsgBox anywhere in this mode:
; messages go through Notify() (a tooltip) or into the checklist window.
;
; Safety: the bin empties itself after g_PriorExpireMin idle minutes so one
; patient's priors can't leak into the next patient's checklist.
; ============================================================================

RegisterPriorHotkeys() {
    global g_PriorAddHotkey, g_PriorListHotkey, g_PriorBoundAdd, g_PriorBoundList
    if (g_PriorBoundAdd != "") {
        try Hotkey, %g_PriorBoundAdd%, Off
        g_PriorBoundAdd := ""
    }
    if (g_PriorBoundList != "") {
        try Hotkey, %g_PriorBoundList%, Off
        g_PriorBoundList := ""
    }
    bad := ""
    if (g_PriorAddHotkey != "") {
        try {
            Hotkey, %g_PriorAddHotkey%, PriorAddHotkey, On
            g_PriorBoundAdd := g_PriorAddHotkey
        } catch e {
            bad .= " " . g_PriorAddHotkey
        }
    }
    if (g_PriorListHotkey != "") {
        try {
            Hotkey, %g_PriorListHotkey%, PriorListHotkey, On
            g_PriorBoundList := g_PriorListHotkey
        } catch e {
            bad .= " " . g_PriorListHotkey
        }
    }
    if (bad != "")
        Toast("Could not bind prior shortcut(s):" . bad, "warn", 6000)
}

PriorAddHotkey:
    PriorAdd()
return

PriorListHotkey:
    PriorChecklist()
return

; Empty the bin if nothing was added for g_PriorExpireMin minutes.
; Returns true if it just emptied a non-empty bin.
PriorExpireCheck() {
    global g_Priors, g_PriorLast, g_PriorExpireMin
    if (g_Priors.Length() = 0 || g_PriorExpireMin <= 0 || g_PriorLast = "")
        return false
    idle := A_Now
    EnvSub, idle, %g_PriorLast%, Minutes
    if (idle < g_PriorExpireMin)
        return false
    g_Priors := []
    g_PriorLast := ""
    UpdatePriorBin()
    return true
}

; Ctrl+C in a console or terminal window stops whatever is running there
; (it is "interrupt", not "copy"). Every tool that presses Ctrl+C asks this
; first; ahk_check.py fails a Ctrl+C that does not.
CopyBlocked() {
    WinGetClass, cls, A
    if (cls = "ConsoleWindowClass" || cls = "CASCADIA_HOSTING_WINDOW_CLASS" || cls = "mintty" || cls = "PuTTY" || cls = "VirtualConsoleClass")
        return true
    WinGet, exe, ProcessName, A
    return (exe = "WindowsTerminal.exe" || exe = "OpenConsole.exe" || exe = "conhost.exe" || exe = "cmd.exe" || exe = "powershell.exe" || exe = "pwsh.exe")
}

; What + Add takes: the text highlighted in the window you are in (it presses
; Ctrl+C there itself, which works where there is no right-click Copy, as in
; Sectra), else what is already on the clipboard. The clipboard is left as it
; was. [Priors] CaptureMode=selectall presses Ctrl+A first: the whole report.
CaptureText(ByRef src) {
    global g_PriorCapture
    prev := Clipboard
    if (CopyBlocked()) {
        src := "copied"
        return Trim(prev, " `t`r`n")
    }
    saved := ClipboardAll
    Clipboard := ""
    Send, {Ctrl up}{Alt up}{Shift up}{LWin up}{RWin up}
    Sleep, 40
    if (g_PriorCapture = "selectall") {
        Send, ^a
        Sleep, 50
    }
    Send, ^c
    ClipWait, 0.6
    if (ErrorLevel) {
        SendEvent, ^c
        ClipWait, 0.5
    }
    got := ErrorLevel ? "" : Clipboard
    Clipboard := saved
    got := Trim(got, " `t`r`n")
    if (StrLen(got) >= 10) {
        src := (g_PriorCapture = "selectall") ? "whole report" : "highlighted"
        return got
    }
    src := "copied"
    return Trim(prev, " `t`r`n")
}

; The exam date at the top of a prior report: { key: "yyyyMMdd", show: "M/D/YYYY" },
; or key "" when none. A date of birth is never taken for it.
PriorDate(text) {
    head := SubStr(text, 1, 700)
    mon := { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
    re := "i)(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})|(\d{4})-(\d{1,2})-(\d{1,2})|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}),? (\d{4})"
    best := "", labelled := false
    pos := 1
    while (pos := RegExMatch(head, re, m, pos)) {
        before := SubStr(head, (pos > 40 ? pos - 40 : 1), (pos > 40 ? 40 : pos - 1))
        pos += StrLen(m)
        if RegExMatch(before, "i)(DOB|birth|born)[^\n]{0,15}$")
            continue
        if (m1 != "") {
            y := m3 + 0, mo := m1 + 0, d := m2 + 0
            if (y < 100)
                y += (y <= Mod(A_Year, 100) + 1) ? 2000 : 1900
        } else if (m4 != "") {
            y := m4 + 0, mo := m5 + 0, d := m6 + 0
        } else {
            y := m9 + 0, mo := mon[SubStr(m7, 1, 3)], d := m8 + 0
        }
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1950 || y > A_Year + 1)
            continue
        cand := { key: Format("{:04d}{:02d}{:02d}", y, mo, d), show: mo . "/" . d . "/" . y }
        isLab := RegExMatch(before, "i)(exam|study|service|procedure|performed|date)[^\n]{0,20}$")
        if (best = "" || (isLab && !labelled)) {
            best := cand
            labelled := isLab
            if (labelled)
                break
        }
    }
    return IsObject(best) ? best : { key: "", show: "" }
}

; The exam name of a prior report ("CT CHEST WITH CONTRAST"), or "".
PriorTitle(text) {
    if RegExMatch(text, "im)^[ \t]*(?:EXAMINATION|EXAM|PROCEDURE|STUDY)[ \t]*:[ \t]*(.+)$", m)
        return SubStr(Trim(m1), 1, 70)
    return ""
}

; What the toolbar shows for a prior: its date and exam, else its first words.
PriorPeek(p) {
    t := (p.title != "") ? p.title : SubStr(RegExReplace(p.text, "\s+", " "), 1, 90)
    return (p.date != "" ? p.date . "  " : "") . t
}

PriorAdd() {
    global g_Priors, g_PriorLast, g_PriorCapture
    expired := PriorExpireCheck()

    text := CaptureText(src)

    if (StrLen(text) < 20) {
        Notify("Prior checklist: nothing highlighted or copied. Highlight the prior report, then Add prior.", 3000)
        return
    }
    for i, p in g_Priors {
        if (p.text == text) {
            Notify("Prior checklist: that report is already in the list as P" . i . ".", 2500)
            return
        }
    }

    pd := PriorDate(text)
    p := { text: text, added: A_Now, date: pd.show, key: pd.key, title: PriorTitle(text) }
    g_Priors.Push(p)
    g_PriorLast := A_Now
    PriorBinRefresh()

    ; Echo what was captured so a wrong selection is obvious.
    msg := "P" . g_Priors.Length() . " added (" . src . "): " . SubStr(PriorPeek(p), 1, 70)
        . (p.date = "" ? "`nNo exam date found at the top; it counts in the order added." : "")
        . "`nAdd more, or Checklist when done."
    if (expired)
        msg := "Old priors were cleared (idle too long).`n" . msg
    Notify(msg, 2500)
}

PriorRemove(i) {
    global g_Priors
    if (i < 1 || i > g_Priors.Length())
        return
    g_Priors.RemoveAt(i)
    UpdatePriorBin()
}

ChartRemove(i) {
    global g_Chart
    if (i < 1 || i > g_Chart.Length())
        return
    g_Chart.RemoveAt(i)
    UpdatePriorBin()
}

PriorClear() {
    global g_Priors, g_PriorLast
    g_Priors := []
    g_PriorLast := ""
    UpdatePriorBin()
    Notify("Prior checklist: list emptied", 1200)
}

; The small always-on-top bin window. Assume-global: it adds a v-named control.
ShowPriorBin() {
    global
    ; Drawn by the hub when it is running; this window is the fallback.
    if (ToolbarPush(true)) {
        if (g_PriorBinShown) {
            Gui, PriorBin:Destroy
            g_PriorBinShown := false
        }
        return
    }
    if (!g_PriorBinShown) {
        Gui, PriorBin:Destroy
        Gui, PriorBin:+AlwaysOnTop +ToolWindow +E0x08000000 -DPIScale
        Gui, PriorBin:Color, 1e1e1e
        Gui, PriorBin:Font, s9 cE8E8E8, Segoe UI
        ; Three parts, each with its own heading: the prior checklist (copy
        ; a prior report, + Add prior, then Checklist), the one-liner's
        ; chart text, and the two report tools.
        Gui, PriorBin:Font, s9 Bold cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Text, x8 y6 w196, Prior checklist
        Gui, PriorBin:Font, s9 Norm cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Button, x210 y3 w20 h20 gPriorBin_Hide, X
        Gui, PriorBin:Add, Text, x8 y24 w220 vPriorBinCount, No priors added yet
        Gui, PriorBin:Add, Button, x8 y44 w78 h24 gPriorBin_Add, + Add prior
        Gui, PriorBin:Add, Button, x90 y44 w76 h24 gPriorBin_List, Checklist
        Gui, PriorBin:Add, Button, x170 y44 w58 h24 gPriorBin_Clear, Empty
        Gui, PriorBin:Font, s9 Bold cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Text, x8 y80 w220, One-liner chart text
        Gui, PriorBin:Font, s9 Norm cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Text, x8 y98 w220 vChartBinCount, Nothing added yet
        Gui, PriorBin:Add, Button, x8 y118 w158 h24 gPriorBin_ChartAdd, + Add copied chart text
        Gui, PriorBin:Add, Button, x170 y118 w58 h24 gPriorBin_ChartClear, Empty
        Gui, PriorBin:Font, s9 Bold cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Text, x8 y154 w220, Write
        Gui, PriorBin:Font, s9 Norm cE8E8E8, Segoe UI
        Gui, PriorBin:Add, Button, x8 y172 w108 h24 gPriorBin_Imp, Impression
        Gui, PriorBin:Add, Button, x120 y172 w108 h24 gPriorBin_OneLiner, One-liner
        priorBinX := A_ScreenWidth - 260
        Gui, PriorBin:Show, x%priorBinX% y120 w236 h204 NoActivate, RadGesture toolbar
        g_PriorBinShown := true
    } else {
        Gui, PriorBin:Show, NoActivate
    }
    UpdatePriorBin()
}

UpdatePriorBin() {
    global g_Priors, g_PriorLast, g_PriorBinShown, g_Chart, g_ToolbarOn
    if (g_ToolbarOn) {
        ToolbarPush(true)
        return
    }
    if (!g_PriorBinShown)
        return
    c := g_Chart.Length()
    ctxt := c ? c . " piece" . (c = 1 ? "" : "s") . ": the next One-liner uses " . (c = 1 ? "it" : "them") : "Nothing added yet"
    GuiControl, PriorBin:, ChartBinCount, %ctxt%
    n := g_Priors.Length()
    txt := "No priors added yet"
    if (n > 0) {
        FormatTime, t, %g_PriorLast%, HH:mm
        txt := n . " prior" . (n = 1 ? "" : "s") . " added (last at " . t . ")"
    }
    GuiControl, PriorBin:, PriorBinCount, %txt%
}

PriorBin_Add:
    PriorAdd()
return

PriorBin_List:
    PriorChecklist()
return

PriorBin_Clear:
    PriorClear()
return

PriorBin_Imp:
    if (!g_Busy)
        ImpressionRun()
return

PriorBin_OneLiner:
    if (!g_Busy)
        Trigger_OneLiner()
return

PriorBin_ChartAdd:
    ChartAdd()
return

ChartAsk_Empty:
    ChartAskClose()
    ChartClear()
return

ChartAsk_Keep:
    ChartAskClose()
    Notify("Chart text kept. Empty it from the toolbar or the ring when done.", 2500)
return

PriorBin_ChartClear:
    ChartClear()
return

ChartAddHotkey:
    ChartAdd()
return

; ---- Chart bin for the one-liner ----------------------------------------
; Copy a part of the chart (note, path report, oncology history...), press
; "+ Add chart text" (toolbar, ring or its shortcut); repeat for each part.
; The next One-liner (any kind) is made from all of them together, in the
; order added, and then a box asks whether to empty the bin. Nothing is sent anywhere
; until the one-liner is made.
ChartExpireCheck() {
    global g_Chart, g_ChartLast, g_PriorExpireMin
    if (g_Chart.Length() = 0 || g_PriorExpireMin <= 0 || g_ChartLast = "")
        return false
    idle := A_Now
    EnvSub, idle, %g_ChartLast%, Minutes
    if (idle < g_PriorExpireMin)
        return false
    g_Chart := []
    g_ChartLast := ""
    UpdatePriorBin()
    return true
}

ChartAdd() {
    global g_Chart, g_ChartLast
    ChartAskClose()
    expired := ChartExpireCheck()
    text := CaptureText(src)
    if (StrLen(text) < 10) {
        Notify("Chart text: nothing highlighted or copied. Highlight a part of the chart, then Add chart text.", 3000)
        return
    }
    for i, p in g_Chart {
        if (p.text == text) {
            Notify("Chart: that text is already added (piece " . i . ").", 2500)
            return
        }
    }
    g_Chart.Push({ text: text, added: A_Now })
    g_ChartLast := A_Now
    PriorBinRefresh()
    peek := SubStr(RegExReplace(text, "\s+", " "), 1, 60)
    msg := "Chart piece C" . g_Chart.Length() . " added (" . src . "): " . peek . "...`nOne-liner now uses all " . g_Chart.Length() . "."
    if (expired)
        msg := "Old chart pieces were cleared (idle too long).`n" . msg
    Notify(msg, 3000)
}

ChartClear(quiet := false) {
    global g_Chart, g_ChartLast
    ChartAskClose()
    g_Chart := []
    g_ChartLast := ""
    UpdatePriorBin()
    if (!quiet)
        Notify("Chart text emptied", 1200)
}

; All pieces as one text for the one-liner, in the order they were added.
ChartText() {
    global g_Chart
    out := ""
    for i, p in g_Chart
        out .= (i > 1 ? "`n`n" : "") . "[Chart excerpt " . i . "]`n" . p.text
    return out
}

; Closing it (X on the title bar or in the window, or Esc) hides it and
; remembers that, so a restart of the helper doesn't bring it straight back.
; Ring > AI Tools > Prior checklist > Show toolbar (or the tray) turns it on again.
PriorBin_Hide:
PriorBinGuiClose:
PriorBinGuiEscape:
    PriorBinSetWanted(false)
    Gui, PriorBin:Hide
    Notify("Toolbar hidden. Bring it back: ring > AI Tools > Prior checklist > Show toolbar.", 3500)
return

; The hub's toolbar: what it shows (each prior's date and exam, each chart
; piece's first words). Its buttons come back as prior:/chart: actions.
ToolbarPush(visible) {
    global g_Priors, g_Chart, g_ToolbarOn
    j := "{""t"":""toolbar"",""visible"":" . (visible ? "true" : "false") . ",""priors"":["
    for i, p in g_Priors
        j .= (i > 1 ? "," : "") . "{""peek"":" . JsonAscii(PriorPeek(p)) . "}"
    j .= "],""chart"":["
    for i, p in g_Chart
        j .= (i > 1 ? "," : "") . "{""peek"":" . JsonAscii(SubStr(RegExReplace(p.text, "\s+", " "), 1, 120)) . "}"
    j .= "]}"
    ok := HubUi(j)
    g_ToolbarOn := ok && visible
    HubPollRefresh()
    return ok
}

PriorBinSetWanted(on) {
    global g_PriorAtStartup, INI_PATH
    g_PriorAtStartup := on ? 1 : 0
    IniWrite, %g_PriorAtStartup%, %INI_PATH%, Priors, ShowAtStartup
}

; After a prior is added: show the count if the toolbar is wanted, never
; pop it up again once it was closed (the count is in the notification too).
PriorBinRefresh() {
    global g_PriorAtStartup
    if (g_PriorAtStartup)
        ShowPriorBin()
    else
        UpdatePriorBin()
}

PriorChecklist() {
    global g_Priors, g_ApiKey, g_PriorMaxTokens

    if (!HaveKey()) {
        Notify("RadGesture: no API key yet. Settings > AI tools.", 3000)
        return
    }
    if (PriorExpireCheck()) {
        Notify("Prior checklist: the list was emptied (idle too long). Add the priors again.", 3000)
        return
    }
    n := g_Priors.Length()
    if (n = 0) {
        Notify("Prior checklist: no priors yet. Copy a prior report, then + Add prior.", 3000)
        return
    }

    examTitle := ReadExamTitle()

    systemPrompt := ""
    . "You help a radiologist who is about to read a NEW exam. You are given one or more PRIOR reports for the same patient, labelled P1, P2, and so on, and the title of the new exam if it is known."
    . "`n`nWrite a VERY SHORT checklist of things to double-check on the new exam so nothing from the priors gets missed:"
    . "`n- known findings that need follow-up"
    . "`n- measurements to compare (give the prior size)"
    . "`n- recommendations the priors made (follow-up imaging, correlation)"
    . "`n- incidentals that were mentioned"
    . "`n`nRULES:"
    . "`n- 3 to 8 lines. Fewer if the priors contain little. Never more than 8."
    . "`n- Write Markdown, one finding per line, exactly like this: '- **Finding in 2 to 5 words**: what to check or compare, at most about 18 words [P2 3/14/2025]'. Bold only the finding name."
    . "`n- End each line with its source in square brackets, with that prior's exam date from its heading when known, e.g. [P2 3/14/2025] or [P1 1/5/2024, P2 3/14/2025]."
    . "`n`nDATES: each prior's heading gives its exam date when one was found, and which prior is the most recent. Findings change between exams:"
    . "`n- When a finding appears in more than one prior, go by the MOST RECENT prior that mentions it: its latest size and status. Give the trend when sizes changed, e.g. '6 mm (P1 1/5/2024) to 8 mm (P2 3/14/2025)'."
    . "`n- A finding that a later prior calls resolved or no longer seen stays on the list, short, marked resolved and placed last, e.g. '- **RUL nodule (resolved)**: gone on P2; confirm still gone [P1 1/5/2024, P2 3/14/2025]'. Never ask to measure or follow up a finding that has resolved."
    . "`n- A recommendation already carried out on a later prior (the follow-up CT was done) is not repeated as pending."
    . "`n- When a date is missing, do not guess one; use the order the priors were given."
    . "`n- Put what the new exam can actually assess first. If the new exam title is known, skip findings in body parts it does not cover unless they are clinically important."
    . "`n- Skip normal and negative findings."
    . "`n- Use only what is in the priors. Do not invent findings, sizes or dates."
    . "`n- Output only the checklist lines. No heading, no preamble, no closing remarks."

    userMsg := "NEW EXAM BEING READ: "
        . (examTitle != "" ? examTitle : "unknown (could not be read from PowerScribe)") . "`n"
    ; Each prior's heading carries its exam date, and which one is newest.
    newest := 0, newestKey := ""
    for i, p in g_Priors
        if (p.key != "" && p.key > newestKey)
            newest := i, newestKey := p.key
    order := PriorOrder()
    if (order != "")
        userMsg .= "PRIORS BY EXAM DATE, OLDEST TO NEWEST: " . order . "`n"
    for i, p in g_Priors {
        userMsg .= "`n=== PRIOR P" . i . (p.date != "" ? " (exam date " . p.date . (i = newest ? ", the most recent prior" : "") . ")" : " (no exam date found)") . " ===`n" . p.text . "`n"
    }

    Notify("RadGesture: making checklist from " . n . " prior" . (n = 1 ? "" : "s") . "...", 0)
    res := PostClaude(systemPrompt, userMsg, g_PriorMaxTokens, "low")
    Notify("", 0, true)

    ShowPriorList(examTitle, n, res.text, res.error)
}

; "P2 (1/5/2024), P1 (3/14/2025)": the dated priors, oldest first. "" when none has a date.
PriorOrder() {
    global g_Priors
    keys := ""
    for i, p in g_Priors
        if (p.key != "")
            keys .= (keys = "" ? "" : "`n") . p.key . "|" . i
    if (keys = "")
        return ""
    Sort, keys
    out := ""
    Loop, Parse, keys, `n
    {
        i := SubStr(A_LoopField, InStr(A_LoopField, "|") + 1) + 0
        out .= (out = "" ? "" : ", ") . "P" . i . " (" . g_Priors[i].date . ")"
    }
    return out
}

; Shared API call: returns {text, error}. Writes the same debug files as the
; proofread call, so Tray -> Show Last API Call works for both modes.
PostClaude(systemPrompt, userMsg, maxTokens, effort := "low", model := "") {
    global g_ApiKey, g_Model
    out := { text: "", error: "" }

    body := "{"
        . """model"":"      . JsonStr(model != "" ? model : g_Model) . ","
        . """max_tokens"":" . ApiMaxTokens(maxTokens) . ","
        . ApiExtras(effort)
        . """system"":"     . JsonStr(systemPrompt) . ","
        . """messages"":[{""role"":""user"",""content"":" . JsonStr(userMsg) . "}]"
        . "}"

    debugReqPath := g_DataDir . "\RadProofread_lastrequest.txt"
    FileDelete, %debugReqPath%
    FileAppend, %body%, %debugReqPath%, UTF-8

    try {
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        http.Open("POST", API_URL, false)
        http.SetRequestHeader("Content-Type", "application/json")
        http.SetRequestHeader("x-api-key", g_ApiKey)
        http.SetRequestHeader("anthropic-version", API_VERSION)
        http.SetTimeouts(10000, 10000, 30000, 120000)
        http.Send(body)
        status := http.Status
        respText := http.ResponseText
    } catch e {
        out.error := "HTTP exception: " . e.Message
        return out
    }

    debugRespPath := g_DataDir . "\RadProofread_lastresponse.txt"
    FileDelete, %debugRespPath%
    debugDump := "HTTP " . status . "`n`n=== RAW RESPONSE ===`n" . respText
    FileAppend, %debugDump%, %debugRespPath%, UTF-8

    if (status < 200 || status >= 300) {
        out.error := ApiErrorText(status, respText)
        return out
    }
    out.text := Trim(ExtractAssistantText(respText), " `t`r`n")
    if (out.text = "")
        out.error := EmptyReplyReason(respText)
    return out
}

; The checklist window. Never takes focus; stays until closed.
ShowPriorList(examTitle, nPriors, text, err) {
    global

    pl_body := ""
    pl_md := ""
    if (err != "") {
        pl_body := "Could not get a checklist.`n`n" . err
    } else {
        ; Keep only list lines; drop any preamble the model adds anyway.
        ; pl_md keeps the Markdown (bold finding names) for the hub's card;
        ; pl_body is plain text, for pasting into the report.
        Loop, Parse, text, `n, `r
        {
            pl_ln := Trim(A_LoopField)
            if !RegExMatch(pl_ln, "^(?:[-*\x{2022}]|\d+[.)])\s+(.+)$", pl_m)
                continue
            pl_md .= (pl_md = "" ? "" : "`n") . "- " . pl_m1
            pl_body .= (pl_body = "" ? "" : "`n") . "-  " . RegExReplace(pl_m1, "\*\*|__|``", "")
        }
        if (pl_body = "") {
            pl_body := RegExReplace(text, "\*\*|__|``", "")
            pl_md := text
        }
    }

    pl_hdr := "Check on: " . (examTitle != "" ? examTitle : "(exam title not read from PowerScribe)")
    FormatTime, pl_now,, HH:mm
    pl_order := PriorOrder()
    pl_sub := "From " . nPriors . " prior" . (nPriors = 1 ? "" : "s") . (pl_order != "" ? ", oldest first: " . pl_order : "") . "  |  " . pl_now
    g_PriorListText := (err != "") ? "" : pl_body
    if (PriorListCard(pl_hdr, pl_sub, g_PriorListText, err, pl_md))
        return

    Gui, PriorList:Destroy
    Gui, PriorList:+AlwaysOnTop +ToolWindow +E0x08000000 -DPIScale
    Gui, PriorList:Color, 1e1e1e
    Gui, PriorList:Font, s10 cFFFFFF Bold, Segoe UI
    Gui, PriorList:Add, Text, x12 y10 w456, %pl_hdr%
    Gui, PriorList:Font, s8 c888888 Norm, Segoe UI
    Gui, PriorList:Add, Text, x12 y+2 w456, %pl_sub%
    Gui, PriorList:Font, s10 cE8E8E8 Norm, Segoe UI
    Gui, PriorList:Add, Text, x12 y+10 w456, %pl_body%
    Gui, PriorList:Font, s9 cE8E8E8 Norm, Segoe UI
    ; Insert pastes into the report: this window never takes focus, so the
    ; window you were in (PowerScribe) still has the cursor.
    g_PriorListText := (err != "") ? "" : pl_body
    if (g_PriorListText != "") {
        Gui, PriorList:Add, Button, x12 y+14 w130 h26 gPriorList_Insert, Insert into report
        Gui, PriorList:Add, Button, x+8 w70 h26 gPriorList_Copy, Copy
        Gui, PriorList:Add, Button, x+8 w70 h26 gPriorList_Close, Close
    } else {
        Gui, PriorList:Add, Button, x12 y+14 w90 h26 gPriorList_Close, Close
    }
    Gui, PriorList:Add, Button, x+8 w150 h26 gPriorList_ClearClose, Clear priors && close
    pl_x := A_ScreenWidth - 520
    Gui, PriorList:Show, x%pl_x% y190 w480 NoActivate, RadGesture Prior Checklist
}

PriorList_Insert:
    PriorListPaste()
return

; The checklist in the hub's card: each line can be ticked off once it is in
; the report. Insert pastes the plain text where the cursor is (the card never
; takes focus) and the card stays open for ticking; Copy; Clear priors.
PriorListCard(hdr, sub, text, err, md) {
    global g_ChartAskHub
    j := "{""t"":""card"",""kind"":""checklist"",""icon"":""checklist"",""title"":" . JsonAscii(hdr) . ",""sub"":" . JsonAscii(sub)
    if (err != "")
        j .= ",""error"":" . JsonAscii("Could not get a checklist.`n`n" . err) . ",""buttons"":[{""id"":""prior:clear"",""label"":""Clear priors"",""icon"":""delete_sweep""},{""id"":""close"",""label"":""Close""}]}"
    else
        j .= ",""checks"":true,""text"":" . JsonAscii(md) . ",""copy"":" . JsonAscii(text) . ",""buttons"":[{""id"":""priorlist:insert"",""label"":""Insert into report"",""icon"":""input"",""primary"":true,""keep"":true},{""id"":""copy"",""label"":""Copy"",""icon"":""content_copy""},{""id"":""prior:clear"",""label"":""Clear priors"",""icon"":""delete_sweep""}]}"
    if !HubUi(j)
        return false
    g_ChartAskHub := false
    HubCardShown()
    return true
}

PriorList_Copy:
    Clipboard := g_PriorListText
    Toast(Chr(0x2713) . " Checklist copied", "ok")
return

PriorList_ClearClose:
    PriorClear()
PriorList_Close:
PriorListGuiClose:
    Gui, PriorList:Destroy
return

; Paste the checklist where the cursor is (normally the PowerScribe report),
; then put the old clipboard back. Keystrokes only: nothing is sent to the
; report editor's window directly, which crashes it.
PriorListPaste() {
    global g_PriorListText
    PasteIntoReport(g_PriorListText, "Checklist")
}

; Paste where the cursor is (normally the PowerScribe report), then put the
; old clipboard back.
PasteIntoReport(text, what) {
    if (text = "")
        return
    if WinActive("RadGesture ahk_class AutoHotkeyGUI") {
        Toast("Click in the report first, then Insert.", "info", 3000)
        return
    }
    savedClip := ClipboardAll
    Clipboard := ""
    Clipboard := text . "`r`n"
    ClipWait, 1
    Send, ^v
    Sleep, 250
    Clipboard := savedClip
    Toast(Chr(0x2713) . " " . what . " inserted", "ok")
}

; ----------------------------------------------------------------------------
; Current exam title from PowerScribe. It only reads control text with
; ControlGetText; it sends nothing to the report editor (which crashes it).
; Returns "" if PowerScribe isn't open or shows no EXAMINATION line.
; ----------------------------------------------------------------------------
ReadExamTitle() {
    psWin := "ahk_exe Nuance.PowerScribe360.exe"
    if !WinExist(psWin)
        return ""

    examText := ""
    WinGet, ctrlList, ControlList, %psWin%
    Loop, Parse, ctrlList, `n
    {
        ctrl := A_LoopField
        if (ctrl = "")
            continue
        if (InStr(ctrl, "RICHEDIT") || InStr(ctrl, "Edit") || InStr(ctrl, "Static") || InStr(ctrl, "STATIC")) {
            ControlGetText, ctrlText, %ctrl%, %psWin%
            if (ctrlText != "") {
                StringUpper, ctrlTextU, ctrlText
                if (InStr(ctrlTextU, "EXAMINATION") || InStr(ctrlTextU, " CT ") || InStr(ctrlTextU, " MR") || InStr(ctrlTextU, "X-RAY") || InStr(ctrlTextU, "PET") || InStr(ctrlTextU, "NM ") || InStr(ctrlTextU, "ULTRASOUND")) {
                    examText .= ctrlText . "`n"
                    if (InStr(ctrlTextU, "EXAMINATION"))
                        break
                }
            }
        }
    }
    if (examText = "")
        return ""

    StringUpper, examUpper, examText
    examPos := InStr(examUpper, "EXAMINATION")
    if (examPos) {
        line := SubStr(examText, examPos + 11)
        line := RegExReplace(line, "^[\s:]+", "")
    } else {
        line := examText
    }
    nlPos := InStr(line, "`n")
    if (nlPos > 0)
        line := SubStr(line, 1, nlPos - 1)
    if (StrLen(line) > 300)
        line := SubStr(line, 1, 300)
    StringReplace, line, line, `,, %A_Space%, All
    line := RegExReplace(line, "\s+\d{1,2}/\d{1,2}/\d{4}.*$", "")
    return Trim(line)
}

; ============================================================================
; ONE-LINER
; ----------------------------------------------------------------------------
; Select text anywhere (Epic, browser, PowerScribe history), press Ctrl+Alt+U
; or the toolbar's One-liner button, pick a flavor. The one-liner lands on the
; clipboard. The API call goes through PostClaude() and the key comes from
; RadGesture.ini like everything else.
;
; The picker DOES take focus, on purpose: it is driven by 1-4 / Esc. It is
; used on selected text, not mid-dictation.
; ============================================================================

RegisterToolHotkeys() {
    global g_OneLinerHotkey, g_ImpHotkey, g_BoundOneLiner, g_BoundImp, g_ChartAddHotkey, g_BoundChartAdd
    if (g_BoundChartAdd != "") {
        try Hotkey, %g_BoundChartAdd%, Off
        g_BoundChartAdd := ""
    }
    if (g_BoundOneLiner != "") {
        try Hotkey, %g_BoundOneLiner%, Off
        g_BoundOneLiner := ""
    }
    if (g_BoundImp != "") {
        try Hotkey, %g_BoundImp%, Off
        g_BoundImp := ""
    }
    bad := ""
    if (g_OneLinerHotkey != "") {
        try {
            Hotkey, %g_OneLinerHotkey%, OneLinerHotkey, On
            g_BoundOneLiner := g_OneLinerHotkey
        } catch e {
            bad .= " " . g_OneLinerHotkey
        }
    }
    if (g_ImpHotkey != "") {
        try {
            Hotkey, %g_ImpHotkey%, ImpressionHotkey, On
            g_BoundImp := g_ImpHotkey
        } catch e {
            bad .= " " . g_ImpHotkey
        }
    }
    if (g_ChartAddHotkey != "") {
        try {
            Hotkey, %g_ChartAddHotkey%, ChartAddHotkey, On
            g_BoundChartAdd := g_ChartAddHotkey
        } catch e {
            bad .= " " . g_ChartAddHotkey
        }
    }
    if (bad != "")
        Toast("Could not bind shortcut(s):" . bad, "warn", 6000)
}

OneLinerHotkey:
    if (g_Busy)
        return
    Trigger_OneLiner()
return

ImpressionHotkey:
    if (g_Busy)
        return
    ImpressionRun()
return

Trigger_OneLiner() {
    global
    ; A flavor picked on the ring skips the picker. Taken (and cleared) up
    ; front so a failed copy can't leave it set for the next Ctrl+Alt+U.
    ol_direct := g_DirectFlavor
    g_DirectFlavor := ""
    if (!HaveKey()) {
        Toast("No API key. Tray -> Settings to add one.", "warn")
        return
    }
    g_Busy := true

    ; Chart pieces collected? Then the one-liner is made from them (no copy).
    ChartAskClose()
    g_FromChart := false
    ChartExpireCheck()
    if (g_Chart.Length() > 0) {
        g_SavedClip := ClipboardAll
        g_PendingText := ChartText()
        g_FromChart := true
        Toast("One-liner from " . g_Chart.Length() . " chart piece" . (g_Chart.Length() = 1 ? "" : "s"), "info", 1400)
        if (ol_direct != "") {
            RunFlavor(ol_direct)
            return
        }
        ShowFlavorPicker()
        return
    }

    if (CopyBlocked()) {
        g_Busy := false
        Toast("One-liner: click in the chart text first.", "warn", 3000)
        return
    }

    ; Stash whatever's currently in the clipboard -- we'll use it as a fallback
    ; for Citrix/Epic where Ctrl+C injection is blocked.
    g_SavedClip := ClipboardAll
    existingClipText := Clipboard  ; text-only snapshot for the fallback

    ; Now try to capture a fresh selection from the foreground app
    Clipboard := ""

    ; CRITICAL: release the physical modifiers from the hotkey press before
    ; sending Ctrl+C. Otherwise the foreground app sees Ctrl+Alt+C, not a copy.
    Send, {Ctrl up}{Alt up}{Shift up}
    Sleep, 60

    ; --- Attempt 1: standard SendInput ---
    Send, ^c
    ClipWait, 1.2, 1

    ; --- Attempt 2: SendEvent (message-queue based) ---
    if (ErrorLevel) {
        SendEvent, ^c
        ClipWait, 1.0, 1
    }

    ; --- Attempt 3: ControlSend to focused control (works in some Citrix cases) ---
    if (ErrorLevel) {
        focusedCtrl := ""
        ControlGetFocus, focusedCtrl, A
        if (focusedCtrl != "") {
            ControlSend, %focusedCtrl%, ^c, A
            ClipWait, 1.0, 1
        }
    }

    ; --- Attempt 4: low-level keybd_event (Citrix-resistant) ---
    if (ErrorLevel) {
        SendCtrlC_LowLevel()
        ClipWait, 1.2, 1
    }

    ; --- Attempt 5: fall back to whatever was in the clipboard already ---
    ; This is the Citrix/Epic workflow: user pre-copies with their fingers
    ; (which Citrix DOES allow), then triggers the hotkey. We use the existing
    ; clipboard contents rather than trying to inject a fresh Ctrl+C.
    usedFallback := false
    if (ErrorLevel) {
        if (StrLen(Trim(existingClipText)) >= 10) {
            Clipboard := existingClipText
            usedFallback := true
        } else {
            Clipboard := g_SavedClip
            activeTitle := ""
            WinGetTitle, activeTitle, A
            Toast("Couldn't copy and clipboard is empty. Active: " . SubStr(activeTitle, 1, 40), "warn")
            g_Busy := false
            return
        }
    }

    selectedText := Clipboard
    if (StrLen(Trim(selectedText)) < 10) {
        Clipboard := g_SavedClip
        Toast("Selection too short (got " . StrLen(Trim(selectedText)) . " chars)", "warn")
        g_Busy := false
        return
    }

    ; Stash selection for the picker handlers
    g_PendingText := selectedText

    ; Tell the user we're using the clipboard fallback path so they know why
    if (usedFallback)
        Toast("Using clipboard contents (Ctrl+C blocked here)", "info", 1400)

    if (ol_direct != "") {
        RunFlavor(ol_direct)
        return
    }
    ShowFlavorPicker()
}

; ----------------------------------------------------------------------------
;  SendCtrlC_LowLevel
;  Uses keybd_event (the lowest-level Win32 keyboard injection API) to send
;  Ctrl+C. This bypasses most input-hook layers that Citrix uses to intercept
;  AHK's Send/SendInput/SendEvent. Last-resort fallback.
; ----------------------------------------------------------------------------
SendCtrlC_LowLevel() {
    ; VK_CONTROL = 0x11, VK_C = 0x43
    ; KEYEVENTF_KEYUP = 0x02
    DllCall("keybd_event", "UChar", 0x11, "UChar", 0,    "UInt", 0,    "Ptr", 0) ; Ctrl down
    Sleep, 20
    DllCall("keybd_event", "UChar", 0x43, "UChar", 0,    "UInt", 0,    "Ptr", 0) ; C down
    Sleep, 30
    DllCall("keybd_event", "UChar", 0x43, "UChar", 0,    "UInt", 0x02, "Ptr", 0) ; C up
    Sleep, 20
    DllCall("keybd_event", "UChar", 0x11, "UChar", 0,    "UInt", 0x02, "Ptr", 0) ; Ctrl up
    Sleep, 30
}

ShowFlavorPicker() {
    global
    if (PickerHub())
        return
    Gui, Picker:Destroy
    Gui, Picker:+AlwaysOnTop -Caption +ToolWindow +Border +LastFound +HwndPickerHwnd
    Gui, Picker:Color, 1e1e1e
    Gui, Picker:Font, s10 cE6E6E6, Segoe UI
    Gui, Picker:Margin, 14, 12

    Gui, Picker:Add, Text,, Select one-liner flavor:
    Gui, Picker:Font, s9 cAAAAAA
    Gui, Picker:Add, Text, y+2, (Esc to cancel)
    Gui, Picker:Font, s10 cE6E6E6

    Gui, Picker:Add, Button, y+10 w260 h32 gPick_Full,    &1  Full medical one-liner
    Gui, Picker:Add, Button, y+4  w260 h32 gPick_Onc,     &2  Oncologic history
    Gui, Picker:Add, Button, y+4  w260 h32 gPick_Tx,      &3  Treatment timeline
    Gui, Picker:Add, Button, y+4  w260 h32 gPick_Ind,     &4  Indication-focused

    g_PickerHwnd := PickerHwnd

    ; Position near cursor
    CoordMode, Mouse, Screen
    MouseGetPos, mx, my
    Gui, Picker:Show, x%mx% y%my% NoActivate, RadGesture One-liner
    WinActivate, ahk_id %PickerHwnd%
}

; The one-liner picker drawn by the hub (1-4, arrows, Enter, Esc). Its choice
; comes back as pick:<flavor> or pick:cancel.
PickerHub() {
    global g_PickerHub, g_FromChart, g_Chart
    n := g_Chart.Length()
    sub := g_FromChart ? "From " . n . " chart piece" . (n = 1 ? "" : "s") : "From the copied text"
    j := "{""t"":""pick"",""title"":""One-liner"",""sub"":" . JsonAscii(sub) . ",""cancel"":""pick:cancel"",""options"":["
        . "{""id"":""pick:full"",""label"":""Full medical one-liner"",""hint"":""History and surgeries in one line"",""icon"":""notes""},"
        . "{""id"":""pick:oncologic"",""label"":""Oncologic history"",""hint"":""Cancers, staging, treatment, current status"",""icon"":""oncology""},"
        . "{""id"":""pick:treatment"",""label"":""Treatment timeline"",""hint"":""Dated procedures and treatments, oldest first"",""icon"":""medication""},"
        . "{""id"":""pick:indication"",""label"":""Indication"",""hint"":""One or two lines for the indication field"",""icon"":""assignment""}]}"
    if !HubUi(j)
        return false
    g_PickerHub := true
    HubCardShown()
    return true
}

PickerHubChoice(choice) {
    global g_PickerHub, g_PendingText
    if (!g_PickerHub)
        return
    g_PickerHub := false
    if (g_PendingText = "" || !RegExMatch(choice, "^(full|oncologic|treatment|indication)$")) {
        PanicTeardown("Cancelled")
        return
    }
    RunFlavor(choice)
}

Pick_Full:
    Gui, Picker:Destroy
    RunFlavor("full")
return

Pick_Onc:
    Gui, Picker:Destroy
    RunFlavor("oncologic")
return

Pick_Tx:
    Gui, Picker:Destroy
    RunFlavor("treatment")
return

Pick_Ind:
    Gui, Picker:Destroy
    RunFlavor("indication")
return

PickerGuiEscape:
    Gui, Picker:Destroy
    PanicTeardown("Cancelled")
return

PickerGuiClose:
    Gui, Picker:Destroy
    PanicTeardown("Cancelled")
return

GetSystemPrompt(flavor) {
    base := "You are a radiology one-liner generator. You will receive patient clinical text as input. Process it immediately and output the one-liner directly.`n`nABSOLUTE RULES:`n- Output ONLY the one-liner itself. Nothing else.`n- Do NOT acknowledge the task (no 'I understand', 'I'll generate', 'Here is', 'Ready to', etc.)`n- Do NOT ask for more information or clarification.`n- Do NOT explain what you are doing or about to do.`n- Do NOT add preamble, postamble, disclaimers, or commentary.`n- Do NOT wrap output in quotes, backticks, or markdown.`n- DO NOT include patient age or sex. Never start with '78yo M' or 'female with' or anything similar. Start directly with the medical content.`n- Use standard radiology abbreviations (s/p, w/, h/o, c/b, dx, etc.)`n- If a field is unknown, omit it silently -- never write 'unknown' or 'not specified'.`n- If the input is too sparse to produce a meaningful one-liner, output exactly: INSUFFICIENT DATA`n`n========================================`nDATE VERIFICATION PROTOCOL (MANDATORY)`n========================================`nThis is a CLINICAL SAFETY requirement. Hallucinated dates are a patient safety problem.`n`nBefore writing ANY date or year in your output, you MUST perform this check:`n`n  STEP 1: Locate the specific phrase in the source text that ties this exact date to this exact event.`n  STEP 2: The phrase must IMMEDIATELY adjoin the date or use unambiguous anchoring language ('on [date]', '[procedure] [date]', 'started [date]', 'completed [date]', 'from [date] to [date]', 'in [year]').`n  STEP 3: If you cannot point to such a phrase, OMIT THE DATE. Write the event without a date.`n`nABSOLUTELY FORBIDDEN:`n- Inferring a date from surrounding context (e.g., 'this event happened between these two dated events, so it must have been around X')`n- Estimating, approximating, rounding, or generalizing dates that are not explicitly given`n- Reusing a date from one event for a nearby event`n- Inferring an imaging study's date from the date of a result mentioned near it`n- Inferring a treatment's date from a related treatment's date`n- Inferring a diagnosis date from a procedure date (e.g., do not assume dx date = biopsy date unless explicitly stated)`n- Using numbers that are NOT dates (MRN digits, lab values, ages, stages, percentages, dosages, cycle counts, accession numbers, T/N/M numbers) as dates`n- Inventing a date because the output 'looks better' with one`n`nCRITICAL EXAMPLE -- this exact failure pattern must be avoided:`n  SOURCE: '...SBRT to the left upper lobe nodule 3/3/24-3/10/24. CT chest showed new mediastinal lymphadenopathy. Started pembrolizumab 9/9/24.'`n  WRONG OUTPUT: '...SBRT 3/3/24-3/10/24; CT chest 6/2024 showed new mediastinal LAD; started pembro 9/9/24...'  (CT chest has NO date in source -- '6/2024' was hallucinated by interpolating between the SBRT and immunotherapy dates)`n  CORRECT OUTPUT: '...SBRT 3/3/24-3/10/24; CT chest showed new mediastinal LAD; started pembro 9/9/24...'  (CT chest mentioned WITHOUT a date because none was given)`n`nThe principle: if a number does not appear in the source text adjacent to or anchored to a specific event, you may NOT write it as that event's date. An undated event is always preferable to a misdated event.`n`nYour entire response must be either the one-liner or 'INSUFFICIENT DATA'. No other output is permitted."

    if (flavor = "full") {
        return base . "`n`nOUTPUT FORMAT: A single-sentence medical summary in radiology style. Start directly with the most clinically significant condition -- NEVER with age or sex. Pattern: [pertinent PMH including cancers, cardiac, pulm, renal, endocrine, neuro] s/p [pertinent surgeries/procedures with years if known]. Keep it scannable. 1-3 lines maximum. Order conditions by clinical significance, not chronologically. Example of correct format: 'HTN, DM2, CAD s/p CABG 2019, CKD3.' Example of WRONG format: '78yo M w/ HTN...'"
    }
    if (flavor = "oncologic") {
        return base . "`n`nOUTPUT FORMAT: A focused oncologic summary. Start directly with the cancer -- NEVER with age or sex. Include: primary cancer(s), staging (TNM or stage if available), date of diagnosis ONLY if explicitly stated, treatments (surgery, chemo regimens, radiation, immunotherapy, targeted therapy) with dates ONLY if explicitly stated, and current disease status (NED, stable, progression, recurrence). If multiple cancers, list each with its own treatment string.`n`nDATE DISCIPLINE FOR THIS FLAVOR:`n- The diagnosis date is ONLY included when the source text uses explicit language like 'diagnosed [date]', 'dx [date]', 'biopsy-proven [date]', 'pathology dated [date]'.`n- Numbers next to a cancer term (e.g., 'breast cancer, T2N1M0, ER+ 95%') are NOT dates -- do not interpret stage values, percentages, lab values, or other clinical numbers as diagnosis dates.`n- If you have a cancer with no clearly-anchored diagnosis date, write the cancer without a date. Example: 'breast cancer, ER+ HER2-, s/p lumpectomy and adjuvant chemo' is correct when no dx date is given. Do NOT invent or guess.`n- Same rule for each treatment date.`n`nPattern with dates available: '[Cancer] dx [date], s/p [treatment] [date], currently [status].'`nPattern without dates: '[Cancer], s/p [treatment], currently [status].'`nGood example: 'Stage IIIA NSCLC dx 3/2023, s/p RUL lobectomy 5/2023, adjuvant carbo/pem x4, currently NED.'`nGood example (no clear dates): 'Stage IIIA NSCLC, s/p RUL lobectomy and adjuvant carbo/pem, currently NED.'`nWRONG: '67yo F w/ stage IIIA NSCLC dx 2020' -- when 2020 was not explicitly tied to the diagnosis."
    }
    if (flavor = "treatment") {
        return base . "`n`nOUTPUT FORMAT: A chronological treatment/procedure timeline. NEVER include age or sex. One line per major intervention. Each line as: [YYYY or MM/YYYY] -- [procedure or treatment]. Include surgeries, chemotherapy regimens, radiation courses, major procedures (ablation, embolization, transplant), and significant hospitalizations only if treatment-relevant. Sort oldest to newest. Omit routine office visits and imaging.`n`nDATE DISCIPLINE FOR THIS FLAVOR:`n- ONLY include an entry if the source text explicitly ties a date to that specific procedure or treatment with anchoring language ('underwent [proc] on [date]', 's/p [proc] [date]', 'started [tx] [date]', 'completed [tx] [date]').`n- A procedure mentioned without an explicit date should be OMITTED from this flavor -- this is the date-focused flavor and undated entries defeat its purpose. Better to have a short accurate timeline than a long timeline with guessed dates.`n- Numbers near treatment terms that are not clearly dates (cycle counts, dosages, percentages, lab values) must NEVER be reinterpreted as dates."
    }
    if (flavor = "indication") {
        return base . "`n`nOUTPUT FORMAT: An indication-focused summary suitable for the indication field of a radiology report. Start directly with the pertinent history -- NEVER with age or sex. Extract ONLY the history pertinent to imaging workup: presenting symptoms, relevant prior cancers/surgeries if they affect the differential, and the specific clinical question if discernible. Maximum 2 sentences. Pattern: [pertinent hx] presenting with [symptom/finding]. Evaluate for [clinical question if clear]. Example: 'H/o colon cancer s/p resection 2022 presenting with elevated CEA. Evaluate for recurrence.'"
    }
    return base
}

StripPreamble(text) {
    text := Trim(text)

    ; Patterns that, if found at the START of the first line, mark it as preamble
    preamblePatterns := [ "i understand", "i'm ready", "i am ready", "i'll", "i will"
                        , "here is", "here's", "ready to", "sure,", "sure!"
                        , "of course", "certainly", "okay,", "ok,", "got it"
                        , "absolutely", "let me", "based on", "looking at"
                        , "waiting for", "send me", "please provide", "please send" ]

    Loop, 3 {  ; up to 3 passes in case of stacked preamble lines
        lines := StrSplit(text, "`n")
        if (lines.MaxIndex() < 1)
            break
        first := Trim(lines[1])
        firstLower := first
        StringLower, firstLower, firstLower

        isPreamble := false
        for idx, pattern in preamblePatterns {
            if (InStr(firstLower, pattern) = 1) {  ; pattern at the very start
                isPreamble := true
                break
            }
        }

        if (!isPreamble)
            break

        ; Remove the first line and any blank line(s) immediately after
        rebuilt := ""
        skippedLeadingBlank := false
        for i, ln in lines {
            if (i = 1)
                continue
            if (!skippedLeadingBlank && Trim(ln) = "")
                continue
            skippedLeadingBlank := true
            rebuilt .= (rebuilt = "" ? "" : "`n") . ln
        }
        text := Trim(rebuilt)
        if (text = "")
            break
    }

    ; Strip wrapping quotes/backticks if the model wrapped output
    text := RegExReplace(text, "^[""'``]+")
    text := RegExReplace(text, "[""'``]+$")
    return Trim(text)
}

Toast(text, kind := "info", autoCloseMs := -1) {
    global g_ToastHwnd, TOAST_MS
    ms := (autoCloseMs >= 0) ? autoCloseMs : TOAST_MS
    if (HubToast(text, kind, ms))
        return
    KillToast()

    color := "1e1e1e"
    border := "3a7bd5"
    if (kind = "ok")    border := "2ecc71"
    if (kind = "warn")  border := "f39c12"
    if (kind = "error") border := "e74c3c"

    Gui, Toast:Destroy
    Gui, Toast:+AlwaysOnTop -Caption +ToolWindow +E0x08000000 +LastFound +HwndToastHwnd
    Gui, Toast:Color, %color%
    Gui, Toast:Font, s10 cE6E6E6, Segoe UI
    Gui, Toast:Margin, 14, 10
    Gui, Toast:Add, Progress, w280 h2 c%border% Background%border%, 100
    Gui, Toast:Add, Text, xm y+8 w280, %text%

    g_ToastHwnd := ToastHwnd

    ; Bottom-right corner
    SysGet, MonW, 16
    SysGet, MonH, 17
    Gui, Toast:Show, x%MonW% y%MonH% NoActivate AutoSize, RadGestureToast
    WinGetPos,,, tw, th, ahk_id %ToastHwnd%
    newX := MonW - tw - 20
    newY := MonH - th - 60
    WinMove, ahk_id %ToastHwnd%,, %newX%, %newY%

    ms := (autoCloseMs >= 0) ? autoCloseMs : TOAST_MS
    if (ms > 0)
        SetTimer, KillToast, -%ms%
}

KillToast() {
    global g_ToastHwnd, g_ToastHub
    if (g_ToastHub) {
        g_ToastHub := false
        HubUi("{""t"":""toast-hide""}")
    }
    if (g_ToastHwnd) {
        Gui, Toast:Destroy
        g_ToastHwnd := 0
    }
}

; The hub draws the helper's small windows (src/panel/): a toast, the
; toolbar, result cards and the one-liner picker. True when it showed it;
; false sends the caller to its own old-style window.
HubUi(json) {
    global g_UiHub
    g_UiHub := (HubRequest("POST", "/ui", 1500, json) = "ok")
    return g_UiHub
}

HubToast(text, kind, ms) {
    global g_ToastHwnd, g_ToastHub
    if !HubUi("{""t"":""toast"",""text"":" . JsonAscii(text) . ",""kind"":" . JsonAscii(kind) . ",""ms"":" . (ms + 0) . "}")
        return false
    if (g_ToastHwnd) {
        Gui, Toast:Destroy
        g_ToastHwnd := 0
    }
    g_ToastHub := true
    return true
}

; Buttons on the hub's windows come back through the poll: poll faster while
; one is showing, so a click feels immediate.
HubPollRate() {
    global g_ProofHub, g_ToolbarOn, g_CardUntil
    if (g_ProofHub)
        return 150
    return (g_ToolbarOn || A_TickCount < g_CardUntil) ? 250 : 750
}

HubPollRefresh() {
    global g_RingOpen
    if (!g_RingOpen)
        SetTimer, HubPoll, % HubPollRate()
}

HubCardShown() {
    global g_CardUntil
    g_CardUntil := A_TickCount + 180000
    HubPollRefresh()
}

; ============================================================================
;  PANIC TEARDOWN  (always restores state, no matter what failed)
; ============================================================================
PanicTeardown(reason := "") {
    global g_Busy, g_PickerHwnd, g_ToastHwnd, g_SavedClip, g_PendingText, g_PickerHub

    KillToast()
    if (g_PickerHub) {
        g_PickerHub := false
        HubUi("{""t"":""pick-close""}")
    }

    if (g_PickerHwnd) {
        Gui, Picker:Destroy
        g_PickerHwnd := 0
    }

    if (g_SavedClip != "")
        Clipboard := g_SavedClip

    g_SavedClip   := ""
    g_PendingText := ""
    g_Busy        := false

    if (reason != "" && reason != "Cancelled")
        Toast(reason, "error")
}

RunFlavor(flavor) {
    global g_PendingText, g_SavedClip, g_Busy, g_FromChart
    Toast("Generating " . flavor . " one-liner...", "info", 0)  ; persistent toast

    ; Extraction only, no creative gap-filling with dates. (No temperature:
    ; the 5.5 models reject it.)
    wrappedUser := "Generate the one-liner from this patient text. Output the one-liner only:`n`n---`n" . g_PendingText . "`n---"
    result := PostClaude(GetSystemPrompt(flavor), wrappedUser, 400, "low")

    KillToast()

    if (result.error != "") {
        PanicTeardown(result.error)
        return
    }

    ; Success: replace clipboard with the one-liner
    Clipboard := StripPreamble(result.text)
    if (g_FromChart) {
        ; Made from the chart bin: ask before emptying it, since the same
        ; pieces may be wanted for another kind of one-liner.
        g_FromChart := false
        Toast(Chr(0x2713) . " Copied (" . FlavorLabel(flavor) . ")", "ok")
        ChartAskEmpty()
    } else
        Toast(Chr(0x2713) . " Copied (" . FlavorLabel(flavor) . ")", "ok")
    g_Busy := false
    g_PendingText := ""
    g_SavedClip := ""  ; we kept the one-liner; don't restore old content later
}

; After a one-liner made from the chart pieces: a small box above the toast
; asks whether to empty them. It never takes focus (the one-liner can be
; pasted while it shows), stays until answered, and closes (keeping the
; pieces) when more chart text is added or another one-liner starts.
ChartAskEmpty() {
    global g_Chart, g_ChartAskHwnd
    ChartAskClose()
    n := g_Chart.Length()
    if (n = 0)
        return
    if (ChartAskCard(n))
        return
    Gui, ChartAsk:+AlwaysOnTop -Caption +ToolWindow +E0x08000000 +LastFound +HwndAskHwnd
    Gui, ChartAsk:Color, 1e1e1e
    Gui, ChartAsk:Font, s10 cE6E6E6, Segoe UI
    Gui, ChartAsk:Margin, 14, 10
    Gui, ChartAsk:Add, Progress, w280 h2 c3a7bd5 Background3a7bd5, 100
    msg := "Empty the chart text (" . n . " piece" . (n = 1 ? "" : "s") . ") for the next patient?"
    Gui, ChartAsk:Add, Text, xm y+8 w280, %msg%
    Gui, ChartAsk:Add, Button, xm y+10 w136 h28 gChartAsk_Empty, Empty it
    Gui, ChartAsk:Add, Button, x+8 w136 h28 gChartAsk_Keep, Keep for another
    g_ChartAskHwnd := AskHwnd
    SysGet, MonW, 16
    SysGet, MonH, 17
    Gui, ChartAsk:Show, x%MonW% y%MonH% NoActivate AutoSize, RadGesture Chart text
    WinGetPos,,, aw, ah, ahk_id %AskHwnd%
    newX := MonW - aw - 20
    newY := MonH - ah - 150
    WinMove, ahk_id %AskHwnd%,, %newX%, %newY%
}

ChartAskCard(n) {
    global g_ChartAskHub
    j := "{""t"":""card"",""kind"":""ask"",""icon"":""playlist_remove"",""title"":""Empty the chart text?"",""sub"":" . JsonAscii(n . " piece" . (n = 1 ? "" : "s") . " made this one-liner")
        . ",""text"":""Empty it for the next patient, or keep it to make another kind of one-liner from the same text."""
        . ",""buttons"":[{""id"":""chart:clear"",""label"":""Empty it"",""icon"":""delete_sweep"",""primary"":true},{""id"":""chart:keep"",""label"":""Keep for another"",""icon"":""bookmark""}]}"
    if !HubUi(j)
        return false
    g_ChartAskHub := true
    HubCardShown()
    return true
}

ChartAskClose() {
    global g_ChartAskHwnd, g_ChartAskHub
    if (g_ChartAskHub) {
        g_ChartAskHub := false
        HubUi("{""t"":""card-close""}")
    }
    if (g_ChartAskHwnd) {
        Gui, ChartAsk:Destroy
        g_ChartAskHwnd := 0
    }
}

FlavorLabel(flavor) {
    if (flavor = "full")
        return "Full"
    if (flavor = "oncologic")
        return "Onc"
    if (flavor = "treatment")
        return "Tx Hx"
    if (flavor = "indication")
        return "Indication"
    return flavor
}

; ============================================================================
; IMPRESSION HELPER
; ----------------------------------------------------------------------------
; Replaces the OpenEvidence round trip for "write a short impression for this
; long study": same rules every time, no retyping "keep it short, no numbers".
;
; Capture: first tries Ctrl+C, so a selection (say, just part of the findings)
; is used as-is. With nothing selected and PowerScribe in front, it falls back
; to Ctrl+A / Ctrl+C like proofread mode, then presses Right to collapse the
; select-all - otherwise pasting the impression would replace the whole report.
; Outside PowerScribe it only ever uses a selection.
;
; Output goes on the clipboard and into a no-focus window with Copy, Open in
; OpenEvidence and Close. OpenEvidence has no public API, so that button
; copies your rules + the findings and opens the site for you to paste.
;
; Your own rules live in Settings > AI tools (RadGesture.ini, [Impression] ExtraRules=), and win
; over the built-in ones.
; ============================================================================

ImpressionRun() {
    global g_ApiKey, g_ImpMaxTokens, g_ImpLastFindings, g_ImpLastText, g_Busy

    if (!HaveKey()) {
        Toast("No API key. Tray -> Settings to add one.", "warn")
        return
    }
    if (CopyBlocked()) {
        Toast("Impression: click in the PowerScribe report first.", "warn", 3000)
        return
    }
    g_Busy := true

    savedClip := ClipboardAll
    Clipboard := ""
    Send, {Ctrl up}{Alt up}{Shift up}
    Send, ^c
    ClipWait, 0.4
    report := ErrorLevel ? "" : Clipboard
    usedSelectAll := false

    if (StrLen(Trim(report)) < 40 && WinActive("ahk_exe Nuance.PowerScribe360.exe")) {
        Clipboard := ""
        Send, ^a
        Sleep, 50
        Send, ^c
        ClipWait, 2
        report := ErrorLevel ? "" : Clipboard
        usedSelectAll := true
    }
    Clipboard := savedClip
    if (usedSelectAll)
        Send, {Right}

    findings := ImpressionFindings(report)
    if (StrLen(findings) < 40) {
        Toast("Impression: nothing to work from. Click in the PowerScribe report, or select the findings.", "warn", 3500)
        g_Busy := false
        return
    }
    g_ImpLastFindings := findings
    g_ImpLastText := ""
    ; The history decides what matters (gallstones only with pain), so send
    ; what comes before FINDINGS: too: exam, history, comparison, technique.
    context := ImpressionContext(report)
    userMsg := (context != "" ? "CLINICAL CONTEXT (exam, history, comparison):`n" . context . "`n`n" : "")
        . "FINDINGS:`n" . findings

    ; The radiologist's own closest impressions, so it comes out in their style.
    styleBlock := HubRequest("POST", "/style/examples", 2000, "{""report"":" . JsonAscii(report) . "}")
    system := ImpressionPrompt() . (styleBlock != "" ? "`n`n" . styleBlock : "")

    Toast("Writing impression...", "info", 0)
    res := PostClaude(system, userMsg, g_ImpMaxTokens, "medium", ImpressionModel())
    KillToast()

    if (res.error != "") {
        ShowImpression("", res.error)
        g_Busy := false
        return
    }
    g_ImpLastText := ImpressionClean(res.text)
    Clipboard := g_ImpLastText
    ShowImpression(g_ImpLastText, "")
    g_Busy := false
}

; What comes before FINDINGS: (exam, clinical history, comparison), at most
; about 1500 characters. "" when the selection has no FINDINGS: header.
ImpressionContext(t) {
    t := Trim(t, " `t`r`n")
    p := InStr(t, "FINDINGS:")
    if (p <= 1)
        return ""
    return SubStr(Trim(SubStr(t, 1, p - 1), " `t`r`n"), 1, 1500)
}

; Hands a finished report to the hub, which keeps its findings and impression
; as an example of this radiologist's style. When Impression wrote a draft for
; these findings, it goes along, so the edits can be seen. Returns the hub's
; answer: "saved:<count>:<kind>", "skip:<why>", "off", or "" (hub not running).
StyleLearn(report, source) {
    global g_ImpLastFindings, g_ImpLastText
    draft := ""
    if (g_ImpLastText != "" && g_ImpLastFindings != "" && InStr(report, SubStr(g_ImpLastFindings, 1, 80)))
        draft := g_ImpLastText
    body := "{""source"":" . JsonAscii(source) . ",""draft"":" . JsonAscii(draft) . ",""report"":" . JsonAscii(report) . "}"
    return HubRequest("POST", "/style/learn", 1500, body)
}

; "Learn this impression" (ring): the report open in PowerScribe, finished,
; becomes an example now, whatever the proofread setting.
StyleLearnNow() {
    if (CopyBlocked()) {
        Toast("Learn this impression: click in the PowerScribe report first.", "warn", 3000)
        return
    }
    savedClip := ClipboardAll
    Clipboard := ""
    Send, {Ctrl up}{Alt up}{Shift up}
    Send, ^a
    Sleep, 50
    Send, ^c
    ClipWait, 2
    report := ErrorLevel ? "" : Clipboard
    Clipboard := savedClip
    Send, {Right}
    if (StrLen(Trim(report)) < 40) {
        Toast("Learn this impression: nothing copied. Click in the PowerScribe report first.", "warn", 3500)
        return
    }
    r := StyleLearn(report, "manual")
    if (SubStr(r, 1, 6) = "saved:") {
        parts := StrSplit(r, ":")
        Toast(Chr(0x2713) . " Learned" . (parts[3] != "" ? " (" . parts[3] . ")" : "") . ". " . parts[2] . " examples of your impressions.", "ok", 2500)
    } else if (r = "skip:no impression")
        Toast("Nothing learned: this report has no IMPRESSION yet.", "warn", 3000)
    else if (r = "skip:no findings")
        Toast("Nothing learned: no FINDINGS found in this report.", "warn", 3000)
    else
        Toast("Nothing learned: RadGesture is not answering. Is it running?", "error", 3500)
}

; Impression can use its own model (Settings > AI tools); default: the same one.
ImpressionModel() {
    global g_ImpModel, g_Model
    return (g_ImpModel = "claude-opus-5-5") ? g_ImpModel : g_Model
}

; The findings part of a report: text after FINDINGS:, cut at IMPRESSION:.
; A selection with neither header is used whole.
ImpressionFindings(t) {
    t := Trim(t, " `t`r`n")
    p := InStr(t, "FINDINGS:")
    if (p)
        t := SubStr(t, p + 9)
    q := InStr(t, "IMPRESSION:")
    if (q)
        t := SubStr(t, 1, q - 1)
    return Trim(t, " `t`r`n")
}

ImpressionPrompt() {
    global g_ImpRules
    p := ""
    . "You write the IMPRESSION of a radiology report for the radiologist who dictated the findings. The impression is a SYNTHESIS, not a summary: what the referring clinician needs to know and do, put together at a high level. Restating the findings in fewer words is wrong."
    . "`n`nHOW TO THINK:"
    . "`n- Read the clinical history first. Ask what question the exam was ordered to answer, and answer it first."
    . "`n- Put related findings together into one conclusion (for example, several signs of one process become one line naming the process), instead of one line per finding."
    . "`n- Say what the findings mean, not what they look like, when the findings support it. Keep the radiologist's level of certainty; never make it stronger."
    . "`n- Rank by what changes management: acute or urgent findings, then the answer to the clinical question, then new findings that need follow-up or workup."
    . "`n- Never leave out a finding that needs follow-up or workup, even when the exam was ordered for something else: a lung nodule that meets Fleischner criteria, a solid or indeterminate liver, kidney, adrenal, pancreatic or thyroid lesion, an aneurysm, suspected malignancy. It gets its own line."
    . "`n`nLEAVE OUT:"
    . "`n- Chronic, stable, degenerative and incidental findings that need no follow-up, unless they explain the symptoms in the history. These almost never belong in the impression: atelectasis, scarring, coronary or vascular calcification, degenerative spine or joint changes, granulomas, simple cysts, small hiatal hernia, diverticulosis without inflammation, gallstones. Example: gallstones go in only if the history mentions abdominal pain, RUQ pain or similar."
    . "`n- Lists of negative findings. Do not answer the history item by item. When nothing acute or actionable is found, the whole impression is ONE short line for the body part, such as: No acute findings in the chest."
    . "`n- Anything already fully conveyed by a line you kept."
    . "`n- Only when you kept at least one positive finding AND left out chronic or incidental ones, end with this exact line: Additional chronic and incidental findings as described in the body of the report. Never add it after a one-line negative impression."
    . "`n`nEXAMPLE (invented):"
    . "`nHistory: fevers, history of cancer. Findings: no consolidation; no suspicious nodule or lymphadenopathy; dependent basilar reticular opacities, likely atelectasis or scarring; coronary artery calcification."
    . "`nWrong impression: No focal consolidation to explain the fevers. No suspicious nodule or lymphadenopathy to suggest metastatic disease. Basilar atelectasis versus scarring. Coronary atherosclerotic calcification."
    . "`nRight impression: No acute findings in the chest."
    . "`n`nFORM:"
    . "`n- Very short: 1 to 4 lines, plus that closing line when it applies. A negative or near-negative study gets exactly one line. Most important first."
    . "`n- No measurements, sizes, dates, or counts written as digits, and no series or image numbers. Anatomic labels such as L4-5, C2 or segment 7 are allowed."
    . "`n- No list numbering and no bullets. PowerScribe numbers the lines itself."
    . "`n- Use only what is in the report. Do not add a diagnosis the findings do not support."
    . "`n- Include a follow-up recommendation only if the findings already state one, or a standard guideline clearly applies to a finding you kept (name the guideline, for example Fleischner)."
    . "`n- Output only the impression lines. No heading, no preamble, no commentary."
    if (Trim(g_ImpRules) != "")
        p .= "`n`nADDITIONAL RULES FROM THE RADIOLOGIST (these override the rules above):`n" . g_ImpRules
    return p
}

; Drop a stray heading, bullets or numbering the model adds anyway.
ImpressionClean(t) {
    t := StripPreamble(t)
    out := ""
    Loop, Parse, t, `n, `r
    {
        ln := Trim(A_LoopField)
        if (ln = "")
            continue
        if RegExMatch(ln, "i)^IMPRESSION:?\s*$")
            continue
        ln := RegExReplace(ln, "i)^IMPRESSION:\s*", "")
        ln := RegExReplace(ln, "^(?:[-*]|\d{1,2}[.)])\s+", "")
        out .= (out = "" ? "" : "`r`n") . ln
    }
    return out
}

; The result window. Never takes focus; stays until closed.
ShowImpression(text, err) {
    global
    if (ImpressionCard(text, err))
        return
    if (err != "") {
        imp_hdr := "Impression: could not generate (Open in OpenEvidence still works)"
        imp_body := err
    } else {
        imp_hdr := "Impression  -  copied to clipboard"
        imp_body := text
    }
    Gui, Impression:Destroy
    Gui, Impression:+AlwaysOnTop +ToolWindow +E0x08000000 -DPIScale
    Gui, Impression:Color, 1e1e1e
    Gui, Impression:Font, s9 c888888, Segoe UI
    Gui, Impression:Add, Text, x12 y10 w456, %imp_hdr%
    Gui, Impression:Font, s10 cE8E8E8, Segoe UI
    Gui, Impression:Add, Text, x12 y+8 w456, %imp_body%
    Gui, Impression:Font, s9 cE8E8E8, Segoe UI
    Gui, Impression:Add, Button, x12 y+14 w80 h26 gImpression_Copy, Copy
    Gui, Impression:Add, Button, x+8 w160 h26 gImpression_OE, Open in OpenEvidence
    Gui, Impression:Add, Button, x+8 w80 h26 gImpression_Close, Close
    imp_x := A_ScreenWidth - 520
    Gui, Impression:Show, x%imp_x% y220 w480 NoActivate, RadGesture Impression
}

; The impression in the hub's card: Insert into report, Copy, OpenEvidence.
ImpressionCard(text, err) {
    global g_ChartAskHub
    j := "{""t"":""card"",""kind"":""impression"",""icon"":""summarize"",""title"":""Impression"""
    if (err != "")
        j .= ",""error"":" . JsonAscii(err) . ",""buttons"":[{""id"":""imp:oe"",""label"":""Open in OpenEvidence"",""icon"":""open_in_new""},{""id"":""close"",""label"":""Close""}]}"
    else
        j .= ",""sub"":""Copied to the clipboard"",""text"":" . JsonAscii(text) . ",""buttons"":[{""id"":""imp:insert"",""label"":""Insert into report"",""icon"":""input"",""primary"":true},{""id"":""copy"",""label"":""Copy"",""icon"":""content_copy""},{""id"":""imp:oe"",""label"":""OpenEvidence"",""icon"":""open_in_new"",""keep"":true}]}"
    if !HubUi(j)
        return false
    g_ChartAskHub := false
    HubCardShown()
    return true
}

ImpressionOE() {
    global g_ImpLastFindings
    ; Same rules, typed for you. Opening the browser takes focus, which is the point.
    Clipboard := ImpressionPrompt() . "`n`nFINDINGS:`n" . g_ImpLastFindings
    Run, https://www.openevidence.com
    Toast("Prompt + findings copied. Paste into OpenEvidence with Ctrl+V.", "info", 4000)
}

Impression_Copy:
    if (g_ImpLastText != "") {
        Clipboard := g_ImpLastText
        Toast(Chr(0x2713) . " Impression copied", "ok")
    }
return

Impression_OE:
    ImpressionOE()
return

Impression_Close:
ImpressionGuiClose:
    Gui, Impression:Destroy
return

; ============================================================================
; SETTINGS MIGRATION
; ----------------------------------------------------------------------------
; An older settings file (RadProofread.ini next to the script) is copied
; when there is no RadGesture.ini yet, so its API key carries over.
; ============================================================================
MigrateOldSettings() {
    global INI_PATH
    if FileExist(INI_PATH)
        return
    old := A_ScriptDir . "\RadProofread.ini"
    if FileExist(old)
        FileCopy, %old%, %INI_PATH%
}

; ============================================================================
; HUB BRIDGE
; ----------------------------------------------------------------------------
; The helper owns the trigger and the hub owns the ring:
;   Ctrl+CapsLock down -> POST /show?app=<exe>   the hub opens the ring
;   CapsLock up        -> POST /release           "action:<id>" | "stay" | "none"
;   Esc while open     -> POST /cancel
;   timer              -> GET  /poll              "action:<id>" for things picked
;                                                 by clicking, or from the hub tray
; Plain text over http://127.0.0.1 only, with the token the hub writes to
; %APPDATA%\RadGesture\bridge.ini. SetProxy(1) keeps a hospital WinHTTP proxy
; from swallowing the localhost calls.
;
; Releasing the trigger runs the picked tool straight away: the ring never
; took focus, so PowerScribe is still the active window when the helper
; presses Ctrl+A / Ctrl+C.
; ============================================================================

RegisterHubHotkeys() {
    global g_HubTrigger, g_HubBoundDown, g_HubBoundUp
    if (g_HubBoundDown != "") {
        try Hotkey, %g_HubBoundDown%, Off
        try Hotkey, %g_HubBoundUp%, Off
    }
    g_HubBoundDown := ""
    g_HubBoundUp := ""
    if (g_HubTrigger = "")
        return
    ; The key without its modifiers, for the release: Ctrl may come up first.
    key := RegExReplace(g_HubTrigger, "^[\^!+#<>*~$]+", "")
    upKey := "~*" . key . " up"
    try {
        Hotkey, %g_HubTrigger%, HubTriggerDown, On
        Hotkey, %upKey%, HubTriggerUp, On
        g_HubBoundDown := g_HubTrigger
        g_HubBoundUp := upKey
    } catch e {
        Toast("Could not bind the ring shortcut " . g_HubTrigger, "warn", 6000)
    }
    ; Esc closes the ring, but only while it is open.
    Hotkey, Esc, HubEsc, On
    Hotkey, Esc, Off
}

HubTriggerDown:
    if (g_RingOpen)
        return  ; key auto-repeat while held
    WinGet, hubExe, ProcessName, A
    hubShow := HubRequest("POST", "/show?app=" . hubExe)
    if (hubShow = "ok") {
        g_RingOpen := true
        Hotkey, Esc, On
        SetTimer, HubPoll, 50
    } else if (hubShow = "paused") {
        Notify("RadGesture is paused (tray icon > Pause the ring)", 1500)
    } else {
        Toast("The RadGesture ring isn't running. Start RadGesture from the Start menu.", "warn", 3500)
    }
return

HubTriggerUp:
    if (!g_RingOpen)
        return
    hubResp := HubRequest("POST", "/release", 1200)
    if (hubResp = "stay")
        return  ; a tap: the ring stays open for clicking, the poll takes over
    HubRingClosed()
    if (SubStr(hubResp, 1, 7) = "action:")
        RunHubAction(SubStr(hubResp, 8))
return

HubEsc:
    HubRequest("POST", "/cancel")
    HubRingClosed()
return

HubPoll:
    hubPollResp := HubRequest("GET", "/poll", 300)
    if (SubStr(hubPollResp, 1, 7) = "action:") {
        ; "keep|<id>": a direction that leaves the ring open (previous / next).
        ; The ring is still up, so Esc and the fast poll stay on.
        hubPollAct := SubStr(hubPollResp, 8)
        if (SubStr(hubPollAct, 1, 5) = "keep|")
            hubPollAct := SubStr(hubPollAct, 6)
        else if (g_RingOpen)
            HubRingClosed()
        RunHubAction(hubPollAct)
    } else if (g_RingOpen && hubPollResp != "open") {
        HubRingClosed()
    }
return

HubRingClosed() {
    global g_RingOpen, g_ProofHub
    g_RingOpen := false
    try Hotkey, Esc, Off
    SetTimer, HubPoll, % HubPollRate()
}

HubReadBridge() {
    global g_HubPort, g_HubToken, g_DataDir
    f := g_DataDir . "\bridge.ini"
    IniRead, p, %f%, Bridge, Port, 47811
    IniRead, t, %f%, Bridge, Token, %A_Space%
    g_HubPort := p + 0
    g_HubToken := Trim(t)
}

; Returns the reply text, or "" if the hub isn't there or said no.
HubRequest(method, path, timeoutMs := 400, body := "") {
    global g_HubPort, g_HubToken, g_HubLastErr
    g_HubLastErr := ""
    if (g_HubToken = "")
        HubReadBridge()
    if (g_HubToken = "") {
        g_HubLastErr := "no-bridge-token"
        return ""
    }
    try {
        http := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        http.SetProxy(1)
        http.Open(method, "http://127.0.0.1:" . g_HubPort . path, false)
        http.SetRequestHeader("X-RG-Token", g_HubToken)
        http.SetTimeouts(200, 200, timeoutMs, timeoutMs)
        if (body != "") {
            http.SetRequestHeader("Content-Type", "text/plain; charset=utf-8")
            http.Send(body)
        } else
            http.Send()
        st := http.Status
        if (st = 200)
            return http.ResponseText
        g_HubLastErr := "http-" . st . "-" . SubStr(http.ResponseText, 1, 40)
        if (st = 403)
            g_HubToken := ""  ; the hub was reinstalled: re-read bridge.ini next time
    } catch e {
        ; Hub not running, or restarting. Re-read the port next time.
        g_HubLastErr := "no-answer-" . SubStr(e.Message, 1, 60)
        g_HubToken := ""
    }
    return ""
}

; What the ring asked for. Ids match "helper:<id>" in the hub's menu.json.
RunHubAction(a) {
    global g_Busy, g_DirectFlavor, g_ToolbarOn, g_ImpLastText, g_ChartAskHub
    ; Let the trigger keys come up first, so Ctrl isn't still held when the
    ; tool sends Ctrl+A / Ctrl+C.
    KeyWait, Control, T1
    KeyWait, CapsLock, T1
    if (a = "reload") {
        ; Settings were saved in the RadGesture window: read them again and
        ; rebind every shortcut.
        LoadSettings()
        RegisterLibraryHotkeys()
        RegisterHotkey()
        RegisterPriorHotkeys()
        RegisterToolHotkeys()
        RegisterHubHotkeys()
        Menu, Tray, DeleteAll
        BuildTrayMenu()
    } else if (a = "suspend") {
        ; The Settings window is recording a shortcut: don't act on the keys.
        ; Comes back on its own after 30 s in case "resume" never arrives.
        Suspend, On
        SetTimer, HubAutoResume, -30000
    } else if (a = "resume") {
        Suspend, Off
    } else if (a = "proofread") {
        ProofreadActiveReport()
    } else if (a = "impression") {
        if (!g_Busy)
            ImpressionRun()
    } else if (a = "style:learn") {
        StyleLearnNow()
    } else if (a = "oneliner") {
        if (!g_Busy)
            Trigger_OneLiner()
    } else if (SubStr(a, 1, 9) = "oneliner:") {
        if (!g_Busy) {
            g_DirectFlavor := SubStr(a, 10)
            Trigger_OneLiner()
        }
    } else if (a = "prior:add") {
        PriorAdd()
    } else if (a = "prior:checklist") {
        PriorChecklist()
    } else if (a = "prior:clear") {
        PriorClear()
    } else if (a = "chart:add") {
        ChartAdd()
    } else if (a = "chart:clear") {
        ChartClear()
    } else if (a = "prior:show") {
        PriorBinSetWanted(true)
        ShowPriorBin()
    } else if (SubStr(a, 1, 13) = "prior:remove:") {
        PriorRemove(SubStr(a, 14) + 0)
    } else if (SubStr(a, 1, 13) = "chart:remove:") {
        ChartRemove(SubStr(a, 14) + 0)
    } else if (a = "chart:keep") {
        g_ChartAskHub := false
        Notify("Chart text kept. Empty it from the toolbar or the ring when done.", 2500)
    } else if (a = "toolbar:hide") {
        ; The toolbar's close button: stays hidden after restarts too.
        PriorBinSetWanted(false)
        g_ToolbarOn := false
        HubPollRefresh()
        Notify("Toolbar hidden. Bring it back: ring > AI Tools > Prior checklist > Show toolbar.", 3500)
    } else if (a = "priorlist:insert") {
        PriorListPaste()
    } else if (a = "imp:insert") {
        PasteIntoReport(g_ImpLastText, "Impression")
    } else if (a = "imp:oe") {
        ImpressionOE()
    } else if (SubStr(a, 1, 5) = "pick:") {
        PickerHubChoice(SubStr(a, 6))
    } else if (a = "settings") {
        OpenAiSettings()
    } else if (a = "history") {
        ShowHistoryViewer()
    } else if (a = "proof:demo") {
        ; An invented report and findings, shown the way a real proofread
        ; is (the Windows end-to-end test uses it). No AI call.
        ProofDemo()
    } else if (a = "oe:clip") {
        ; Search copied text > OpenEvidence: ask it what was copied.
        OpenEvidenceAsk(Clipboard)
    } else if (a = "testkey") {
        TestApiKey()
    } else if (a = "lastcall") {
        ShowLastApiCall()
    } else if (SubStr(a, 1, 6) = "proof:") {
        ProofHubAction(a)
    } else if (SubStr(a, 1, 4) = "run:") {
        RunProgram(SubStr(a, 5))
    } else if (SubStr(a, 1, 4) = "lib:") {
        ; A function from the function collection.
        LibRun(SubStr(a, 5))
    } else if (SubStr(a, 1, 5) = "keys:") {
        hubKeys := SubStr(a, 6)
        ; SendLevel 1 so another script's hotkeys (a timer's F4 / F12)
        ; react to these keys, as they would to the real ones.
        SendLevel, 1
        Send, %hubKeys%
        SendLevel, 0
    } else {
        Toast("Unknown action from the ring: " . a, "warn")
    }
    ; Tell the hub it ran (Settings > Status shows it; the Windows tests check it).
    HubRequest("POST", "/done?action=" . a)
}

HubAutoResume:
    Suspend, Off
return

; ============================================================================
; POWERSCRIBE PICK LISTS
; ----------------------------------------------------------------------------
; Finds an entry in one of PowerScribe's pick lists (Insert priors and Paste
; indication use it to find the Comparison / Indication field). A read-only
; question, so it goes by SendMessage, the only way to get an answer; every
; change to PowerScribe goes by PostMessage. tools/ahk_check.py allows
; SendMessage for read-only list questions only.
; ============================================================================

PS_LB_FindExact(hCtrl, text) {
    static LB_FINDSTRINGEXACT := 0x1A2
    VarSetCapacity(wText, (StrLen(text)+1)*2, 0)
    StrPut(text, &wText, "UTF-16")
    return DllCall("SendMessageW"
        , "Ptr", hCtrl
        , "UInt", LB_FINDSTRINGEXACT
        , "Ptr", -1
        , "Ptr", &wText
        , "Ptr")
}

; ============================================================================
; FUNCTION COLLECTION  (Settings > Functions)
; ----------------------------------------------------------------------------
; config/library.json lists every function with its description and defaults;
; Settings > Functions is where a person turns a keyboard shortcut on or off,
; changes it, and sets the key each function presses inside Sectra or
; PowerScribe. All of that lives in RadGesture.ini [Lib.<id>] (the hub fills
; in the defaults before the helper starts). Two ways in:
;   - its keyboard shortcut (RegisterLibraryHotkeys; a mouse button or macro
;     pad set to send that shortcut works the same), and
;   - the ring: "helper:lib:<id>" -> RunHubAction -> LibRun(id).
; Every id here must be in config/library.json and the other way round
; (test/library.test.js).
; ============================================================================


; Keyboard shortcuts for the library functions that are switched on. Runs
; BEFORE RadGesture's own shortcuts are bound, so if a person gives a library
; function the same key as Proofread (Settings warns), Proofread wins.
RegisterLibraryHotkeys() {
    global g_LibBound, LIB_IDS
    for hk in g_LibBound
        try Hotkey, %hk%, Off
    g_LibBound := {}
    failed := ""
    ; Built-in functions, then "My functions" (written in Settings > Functions).
    IniRead, mine, %INI_PATH%, Library, Custom, %A_Space%
    mine := Trim(mine)
    ids := LIB_IDS . (mine != "" ? "|" . mine : "")
    Loop, Parse, ids, |
    {
        id := A_LoopField
        if (LibParam(id, "On", "0") != "1")
            continue
        hk := LibParam(id, "Hotkey")
        if (hk = "" || g_LibBound.HasKey(hk))
            continue
        try {
            Hotkey, %hk%, LibHotkey, On
            g_LibBound[hk] := id
        } catch {
            failed .= (failed = "" ? "" : ", ") . id
        }
    }
    if (failed != "")
        Toast("These function shortcuts could not be set: " . failed . ". Change them in Settings > Functions.", "warn")
    ; Settings shows how many are really listening ("lib-hotkeys:<n>:<failed>").
    HubRequest("POST", "/done?action=lib-hotkeys:" . g_LibBound.Count() . ":" . failed)
}

LibHotkey:
    g_LibKeyId := g_LibBound[A_ThisHotkey]
    LibRun(g_LibKeyId)
    ; Settings > Status shows it; the Windows tests check it.
    HubRequest("POST", "/done?action=lib-key:" . g_LibKeyId)
return

; One setting of a library function, from RadGesture.ini [Lib.<id>].
LibParam(id, name, dflt := "") {
    global INI_PATH
    IniRead, v, %INI_PATH%, Lib.%id%, %name%, %A_Space%
    v := Trim(v)
    return (v = "") ? dflt : v
}

LibRun(id) {
    if (id = "")
        return false
    ; One of "My functions": its own script, run by the bundled AutoHotkey.
    if (LibParam(id, "Custom") = "1")
        return LibRunCustom(id)
    ; "Bring this program up and press its key": most functions.
    target := LibParam(id, "Target")
    if (target != "")
        return LibPress(target, LibParam(id, "Key"), id)
    if (id = "PS_ToggleDictation")
        return Lib_ToggleDictation(LibParam(id, "Key", "{F4}"), LibParam(id, "SectraKey"))
    if (id = "PS_PasteIndication")
        return Lib_PasteIndication()
    if (id = "PACS_Insert_Priors")
        return Lib_InsertPriors(LibParam(id, "Key", "^p"))
    if (id = "LoginUandP")
        return Lib_Login(true, true, LibParam(id, "Tab", "1") = "1", LibParam(id, "Enter", "1") = "1")
    if (id = "LoginU")
        return Lib_Login(true, false, LibParam(id, "Tab", "0") = "1", false)
    if (id = "LoginP")
        return Lib_Login(false, true, false, LibParam(id, "Enter", "0") = "1")
    if (id = "LoginForget") {
        g_LibPass := ""
        Notify("Password forgotten. The next login asks again.", 2000)
        return true
    }
    if (id = "ActivateEPIC")
        return Lib_ActivateEPIC()
    if (id = "ActivateTeams")
        return Lib_ActivateTeams()
    if (id = "OpenChromeTabs")
        return Lib_OpenTabs(LibParam(id, "Urls"))
    if (id = "SearchRadiopaediaGoogle")
        return Lib_SearchRadiopaediaGoogle()
    Toast("Unknown library function: " . id, "warn")
    return false
}

; "My functions": %APPDATA%\RadGesture\functions\<id>.ahk, written by
; Settings > Functions. Run as a separate AutoHotkey process (the AutoHotkey
; that ships next to the helper), so a mistake in it shows AutoHotkey's own
; error box and can never stop or freeze the helper.
LibRunCustom(id) {
    global g_DataDir
    file := g_DataDir . "\functions\" . id . ".ahk"
    if !FileExist(file) {
        Notify("This function's script is missing (Settings > Functions)", 2500)
        return false
    }
    exe := LibAutoHotkey()
    if (exe = "") {
        Notify("AutoHotkey is missing from the RadGesture folder: reinstall RadGesture", 3000)
        return false
    }
    Run, "%exe%" "%file%", %g_DataDir%\functions, UseErrorLevel
    return (ErrorLevel != "ERROR")
}

; The AutoHotkey that runs "My functions": shipped next to the helper; when
; the helper itself runs as a script (fallback, development), that AutoHotkey.
LibAutoHotkey() {
    if FileExist(A_ScriptDir . "\AutoHotkeyU64.exe")
        return A_ScriptDir . "\AutoHotkeyU64.exe"
    if (!A_IsCompiled && FileExist(A_AhkPath))
        return A_AhkPath
    return ""
}

; Copy the highlighted text, reliably, from inside a keyboard shortcut.
; The shortcut's own Ctrl / Alt may still be held (a mouse button or macro
; pad releases them a moment later), which turns Ctrl+C into Ctrl+Alt+C, and
; some programs (Epic, Citrix) ignore the first kind of copy. So: let go of
; the modifiers, then try the ways the One-liner uses, and finally the window
; under the mouse (where the highlighted text is). Returns the text, or ""
; when nothing was highlighted. The clipboard is put back as it was.
LibCopySelection() {
    if (CopyBlocked())
        return ""
    saved := ClipboardAll
    Clipboard := ""
    Send, {Ctrl up}{Alt up}{Shift up}{LWin up}{RWin up}
    Sleep, 60
    Send, ^c
    ClipWait, 1
    if (ErrorLevel) {
        SendEvent, ^c
        ClipWait, 0.8
    }
    if (ErrorLevel) {
        focused := ""
        ControlGetFocus, focused, A
        if (focused != "") {
            ControlSend, %focused%, ^c, A
            ClipWait, 0.8
        }
    }
    if (ErrorLevel) {
        SendCtrlC_LowLevel()
        ClipWait, 1
    }
    if (ErrorLevel) {
        MouseGetPos, , , underMouse
        if (underMouse && !WinActive("ahk_id " . underMouse)) {
            WinActivate, ahk_id %underMouse%
            WinWaitActive, ahk_id %underMouse%, , 1
            Send, ^c
            ClipWait, 1
        }
    }
    text := ErrorLevel ? "" : Clipboard
    Clipboard := saved
    return text
}

; Windows blocks a program from typing into one that runs as administrator
; unless it runs as administrator too, and does it silently: the keys just
; vanish. Say so (once per program per session) instead of failing quietly.
LibCheckAccess(win, label) {
    static warned := {}
    if (A_IsAdmin || warned.HasKey(label))
        return
    if (LibIsElevated(win) = 1) {
        warned[label] := true
        Toast(label . " runs as administrator, so Windows may block RadGesture from typing into it. If nothing happens, quit RadGesture and start it with ""Run as administrator"".", "warn", 9000)
    }
}

; 1 = the window's program runs as administrator (or its token can't be
; read, which for a program on this desktop means the same), 0 = it doesn't,
; -1 = unknown.
LibIsElevated(win) {
    WinGet, pid, PID, %win%
    if (!pid)
        return -1
    hProc := DllCall("OpenProcess", "UInt", 0x1000, "Int", 0, "UInt", pid, "Ptr")
    if (!hProc)
        return -1
    tok := 0
    if !DllCall("advapi32\OpenProcessToken", "Ptr", hProc, "UInt", 0x0008, "Ptr*", tok) {
        DllCall("CloseHandle", "Ptr", hProc)
        return 1
    }
    VarSetCapacity(elev, 4, 0)
    got := 0
    ok := DllCall("advapi32\GetTokenInformation", "Ptr", tok, "Int", 20, "Ptr", &elev, "UInt", 4, "UInt*", got)
    DllCall("CloseHandle", "Ptr", tok)
    DllCall("CloseHandle", "Ptr", hProc)
    return ok ? (NumGet(elev, 0, "UInt") ? 1 : 0) : -1
}

LibWindow(target) {
    if (target = "sectra")
        return "Image Window"
    if (target = "powerscribe")
        return "ahk_exe Nuance.PowerScribe360.exe"
    return target
}

; Most functions: bring Sectra's image window (or PowerScribe) to the front
; and press one key there. If the program is not open, say so instead of
; pressing the key into whatever window is in front (a "2" typed into the
; report); wait up to a second for it to come up before pressing.
LibPress(target, keys, id := "") {
    win := LibWindow(target)
    if (keys = "") {
        Notify("No key set for this yet. Record the key your " . (target = "powerscribe" ? "PowerScribe" : "Sectra") . " uses: Settings > Functions.", 3000)
        return false
    }
    if !WinExist(win) {
        Notify((target = "sectra" ? "Sectra's image window" : target = "powerscribe" ? "PowerScribe" : win) . " is not open", 2000)
        return false
    }
    LibCheckAccess(win, target = "sectra" ? "Sectra" : target = "powerscribe" ? "PowerScribe" : win)
    WinActivate, %win%
    WinWaitActive, %win%, , 1
    ; A shortcut from a mouse button or macro pad still holds its own keys
    ; (Ctrl+Alt of Ctrl+Alt+M) when it lands here: let go of them first, or
    ; Sectra receives Ctrl+Alt+M instead of the Alt+M it answers to.
    Send, {Ctrl up}{Alt up}{Shift up}{LWin up}{RWin up}
    Sleep, 30
    Send, %keys%
    return true
}

; Dictate: two steps, in two programs.
;   1. Sectra: press its "Dictate" key (F8 by default). Sectra then opens the
;      exam that is open in Sectra in PowerScribe, ready for dictation.
;   2. PowerScribe: bring that window to the front (so it is definitely the
;      one listening) and press its dictation key (F4 by default), which
;      switches the microphone on, or off when it is already on.
; Both keys are set in Settings > Functions. With the Sectra key empty, or
; Sectra not open, it only toggles dictation in PowerScribe.
Lib_ToggleDictation(psKey, sectraKey) {
    if (sectraKey != "" && WinExist("Image Window")) {
        LibCheckAccess("Image Window", "Sectra")
        WinActivate, Image Window
        WinWaitActive, Image Window, , 1
        Send, %sectraKey%
        Sleep, 50
    }
    ; PowerScribe may still be starting up after step 1: give it a few seconds.
    WinWait, ahk_exe Nuance.PowerScribe360.exe, , 5
    if (ErrorLevel) {
        Notify("PowerScribe did not open", 2500)
        return false
    }
    WinActivate, ahk_exe Nuance.PowerScribe360.exe
    WinWaitActive, ahk_exe Nuance.PowerScribe360.exe, , 1
    Send, %psKey%
    return true
}

; Insert priors: select the Comparison field in PowerScribe, then bring up
; Sectra and press its "insert priors" key (Ctrl+P by default), so the prior
; studies land in Comparison. Finding the field asks the pick lists a
; read-only question (LB_FINDSTRINGEXACT); the field is chosen with Control,
; ChooseString.
Lib_InsertPriors(sectraKey) {
    ps := "ahk_exe Nuance.PowerScribe360.exe"
    fieldName := "Comparison"

    ; Step 1: activate PowerScribe and select "Comparison"
    if !WinExist(ps) {
        Notify("PowerScribe is not open", 2000)
        return false
    }
    LibCheckAccess(ps, "PowerScribe")
    WinActivate, %ps%
    WinWaitActive, %ps%, , 1.5
    if !WinActive(ps) {
        Notify("Could not bring up PowerScribe", 2000)
        return false
    }

    WinGet, list, ControlList, %ps%
    found := false

    Loop, Parse, list, `n
    {
        ctrl := A_LoopField
        if !InStr(ctrl, "LISTBOX")
            continue

        ControlGet, h, Hwnd,, %ctrl%, %ps%
        if (!h)
            continue

        idx := PS_LB_FindExact(h, fieldName)
        if (idx < 0)
            continue

        ControlFocus, %ctrl%, %ps%
        Sleep 30
        Control, ChooseString, %fieldName%, %ctrl%, %ps%
        found := true
        break
    }

    if (!found) {
        Notify("No Comparison field in this report", 2000)
        return false
    }

    ; Step 2: activate Image Window and send the Sectra shortcut
    WinActivate, Image Window
    WinWaitActive, Image Window, , 1.0
    Send, %sectraKey%
    return true
}

; Paste indication: copy the highlighted text, select the Indication field in
; PowerScribe and paste it there. The clipboard you had comes back after.
Lib_PasteIndication() {
    ps := "ahk_exe Nuance.PowerScribe360.exe"
    fieldName := "Indication"

    ; Step 1: copy the highlighted text (see LibCopySelection)
    selectedText := LibCopySelection()
    if (selectedText = "") {
        Notify("Paste indication: highlight the indication first", 2500)
        return false
    }
    ClipSaved := ClipboardAll

    ; Step 2: Activate PowerScribe window
    if !WinExist(ps) {
        Notify("PowerScribe is not open", 2000)
        return false
    }
    LibCheckAccess(ps, "PowerScribe")
    WinActivate, %ps%
    WinWaitActive, %ps%, , 1.5
    if !WinActive(ps) {
        Notify("Could not bring up PowerScribe", 2000)
        return false
    }

    ; Step 3: Scan all controls for a ListBox containing "Indication"
    WinGet, list, ControlList, %ps%
    found := false
    Loop, Parse, list, `n
    {
        ctrl := A_LoopField
        if !InStr(ctrl, "LISTBOX")
            continue
        ControlGet, h, Hwnd,, %ctrl%, %ps%
        if (!h)
            continue
        idx := PS_LB_FindExact(h, fieldName)
        if (idx < 0)
            continue
        ControlFocus, %ctrl%, %ps%
        Sleep, 30
        Control, ChooseString, %fieldName%, %ctrl%, %ps%
        found := true
        break
    }

    if (!found) {
        Notify("Paste indication: no Indication field in this report", 2500)
        return false
    }

    ; Step 4: Put selected text into clipboard and paste into the Indication field
    Sleep, 150
    Clipboard := selectedText
    Send ^v

    ; Step 5: Restore original clipboard after a brief delay
    Sleep, 300
    Clipboard := ClipSaved
    return true
}

; Logins: no username or password in the code. The username comes from
; Settings > Functions; the password is asked once per session and kept only
; in memory. {Raw} so a password with ! + ^ # { is typed as it is, not as Alt/Shift/...
Lib_Login(typeUser, typePass, tab, enter) {
    global INI_PATH
    user := ""
    if (typeUser) {
        IniRead, user, %INI_PATH%, Library, Username, %A_Space%
        user := Trim(user)
        if (user = "") {
            Notify("Set your username in Settings > Functions first", 2500)
            return false
        }
    }
    if (typePass && !LibPassword())
        return false
    if (typeUser) {
        SendEvent, {Raw}%user%
        if (tab) {
            SendEvent, {Tab}
            Sleep, 200
        }
    }
    if (typePass) {
        pass := g_LibPass
        SendEvent, {Raw}%pass%
        if (enter)
            SendEvent, {Enter}
    }
    return true
}

; Asks for the password the first time, then remembers it until the helper
; stops (or "Forget the password").
LibPassword() {
    global g_LibPass
    if (g_LibPass != "")
        return true
    WinGet, prevId, ID, A
    InputBox, entered, RadGesture, Password for this session (kept in memory only):, HIDE, 340, 130
    if (ErrorLevel || entered = "")
        return false
    g_LibPass := entered
    WinActivate, ahk_id %prevId%
    WinWaitActive, ahk_id %prevId%, , 1
    return true
}

; Epic: bring Hyperspace to the front; say so when Epic is not open.
Lib_ActivateEPIC() {
    if !WinExist("Hyperspace") {
        Notify("Epic (Hyperspace) is not open", 2000)
        return false
    }
    WinActivate, Hyperspace
    return true
}

; Teams: bring it to the front, or start it.
Lib_ActivateTeams() {
    if WinExist("Teams")
    {
        WinActivate
        return true
    }

    Run, ms-teams:
    WinWait, Teams, , 10
    if WinExist("Teams")
    {
        WinActivate
        return true
    }

    return false
}

; Open my websites: the list from Settings > Functions, in Chrome (or the
; default browser when Chrome is not installed). A URL is passed as a
; variable, so its % signs need no escaping.
Lib_OpenTabs(urls) {
    if (urls = "") {
        Notify("No websites set (Settings > Functions)", 2000)
        return false
    }
    Loop, Parse, urls, |
    {
        url := Trim(A_LoopField)
        if (url = "")
            continue
        try Run, chrome.exe "%url%"
        catch
            Run, %url%
    }
    return true
}

; Search selection: copy the highlighted text and offer Google Images,
; Radiopaedia or both. Its window and labels are named LibSearch so they
; can't collide with the helper's; Esc closes it.
Lib_SearchRadiopaediaGoogle() {
    global g_LibSearchTerm
    term := Trim(LibCopySelection())
    if (term = "") {
        Notify("Highlight some text first", 1500)
        return false
    }
    g_LibSearchTerm := term

    ; Grab active window position before doing anything else
    WinGetPos, wx, wy, ww, wh, A

    Gui, LibSearch:New, +AlwaysOnTop +ToolWindow -SysMenu, Search
    Gui, LibSearch:Add, Text,   x20 y16 w300, % """" . (StrLen(term) > 45 ? SubStr(term,1,45) "..." : term) . """"
    Gui, LibSearch:Add, Button, x20 y48  w300 h34 gLibSearch_Gimg,  Google Images
    Gui, LibSearch:Add, Button, x20 y90  w300 h34 gLibSearch_Rpad,  Radiopaedia
    Gui, LibSearch:Add, Button, x20 y132 w300 h34 gLibSearch_Oe,    OpenEvidence
    Gui, LibSearch:Add, Button, x20 y174 w300 h34 gLibSearch_Both,  Google Images + Radiopaedia
    Gui, LibSearch:Add, Button, x20 y220 w300 h26 gLibSearch_Close, Cancel

    ; Center GUI over the source window
    guiW := 340, guiH := 262
    gx := wx + (ww - guiW) // 2
    gy := wy + (wh - guiH) // 2
    Gui, LibSearch:Show, x%gx% y%gy% w%guiW% h%guiH%
    return true
}

LibSearch_Gimg:
    Gui, LibSearch:Destroy
    LibSearch_OpenURL("https://www.google.com/search?tbm=isch&q=" . LibSearch_Enc(g_LibSearchTerm))
return

LibSearch_Rpad:
    Gui, LibSearch:Destroy
    LibSearch_OpenURL("https://radiopaedia.org/search?q=" . LibSearch_Enc(g_LibSearchTerm))
return

LibSearch_Both:
    Gui, LibSearch:Destroy
    LibSearch_OpenURL("https://www.google.com/search?tbm=isch&q=" . LibSearch_Enc(g_LibSearchTerm))
    Sleep, 300
    LibSearch_OpenURL("https://radiopaedia.org/search?q=" . LibSearch_Enc(g_LibSearchTerm))
return

LibSearch_Oe:
    Gui, LibSearch:Destroy
    OpenEvidenceAsk(g_LibSearchTerm)
return

LibSearchGuiClose:
LibSearchGuiEscape:
LibSearch_Close:
    Gui, LibSearch:Destroy
return

; Ask OpenEvidence a question. Its site takes no question in the address, so
; it opens in the browser, and once its tab is in front the question is
; pasted into the box and sent. It types only when the window in front is
; OpenEvidence; the question also stays on the clipboard, so if the box was
; not ready it is one click and Ctrl+V away.
OpenEvidenceAsk(term) {
    term := Trim(term, " `t`r`n")
    if (term = "") {
        Notify("Copy or highlight a question first", 1500)
        return false
    }
    Clipboard := term
    ClipWait, 1
    LibSearch_OpenURL("https://www.openevidence.com/")
    SetTitleMatchMode, 2
    WinWaitActive, OpenEvidence, , 15
    if (ErrorLevel) {
        Toast("OpenEvidence is opening. Your question is copied: click the box and press Ctrl+V.", "info", 6000)
        return false
    }
    Sleep, 1800  ; the page's question box appears after the page loads
    if !WinActive("OpenEvidence")
        return false
    Send, ^v
    Sleep, 250
    Send, {Enter}
    Toast("Asked OpenEvidence. If the box was empty: click it and press Ctrl+V.", "info", 4000)
    return true
}

LibSearch_OpenURL(url) {
    try Run, chrome.exe "%url%"
    catch
        Run, %url%
}

LibSearch_Enc(str) {
    out := ""
    Loop, Parse, str
        out .= (A_LoopField ~= "[A-Za-z0-9\-._~]") ? A_LoopField : "%" Format("{:02X}", Ord(A_LoopField))
    return out
}
