# What RadGesture does on a PC

A plain account for IT and security reviewers. Every statement below can be
checked against the source in this repository; the file that does it is named.

## What is installed

| Part | What it is |
|---|---|
| `RadGesture.exe` | The app (Electron): the ring menu, Settings, the reference viewer. Source: `src/` |
| `resources\helper\RadGestureHelper.exe` | A helper compiled from `helper/RadGestureHelper.ahk` (AutoHotkey v1.1). It does every key press, copy and paste, and the AI requests. Only the compiled helper ships, never a loose script |
| `resources\helper\AutoHotkeyU64.exe` | The standard AutoHotkey v1.1 program, used **only** to run functions the user writes themselves in Settings > Functions > My functions. Without any, it is never started |

- **Setup** installs for the current Windows user only, in
  `%LOCALAPPDATA%\Programs\RadGesture`. No administrator rights, no services,
  no drivers. **Portable** is a zip that runs where it is unzipped.
- Both are built from this source by `.github/workflows/build-windows.yml`.
  Publisher in the file details: Avecina Studio. The files are not
  code-signed.

## What it does with the keyboard, the screen and the clipboard

- **Listens for its own shortcuts**: Ctrl+CapsLock opens the ring, plus the
  shortcuts listed in Settings > Functions (all can be changed or turned
  off). Other keys are not recorded or stored.
- **Presses keys in Sectra and PowerScribe** when the user picks a function,
  e.g. a window/level preset. Only on the user's action.
- **Copies and pastes** when the user runs a tool: Proofread copies the open
  report (Ctrl+A, Ctrl+C), the one-liner copies the selected text, results are
  pasted where the cursor is. The clipboard is restored afterwards where the
  tool says so.
- **Login functions** type the user's username and password into their own
  work programs. The password is asked once per session and **kept in memory
  only, never written to disk** (`LibPassword()` in the helper). No username,
  password or work link is in this repository (`test/library.test.js`).
- **Settings > Status** lists running programs (a PowerShell
  `Get-CimInstance Win32_Process` query, `src/main/conflicts.js`) to find
  older tools that claim the same keys, and closes them only when the user
  clicks to.

## AI tools: what leaves the PC

The AI tools (Proofread, Impression, One-liner, Prior checklist) send the text
they work on **to Anthropic's Claude API, `https://api.anthropic.com`**, using
the user's own API key. That text is radiology report text and can contain
patient information. Nothing is sent until the user runs one of these tools.
Whether this is allowed is the user's organisation's decision; the tools can
simply be left unused (no key = nothing is ever sent).

## What it stores

All in `%APPDATA%\RadGesture`:

| File | Holds |
|---|---|
| `RadGesture.ini` | Settings, **including the user's Claude API key in plain text** (readable by that Windows user) |
| `menu.json` | The rings |
| `RadProofread_history.jsonl` | **Each proofread: the full report text and the findings**, so past results can be reviewed. It is not cleared automatically |
| `RadProofread_lastrequest.txt`, `..._lastresponse.txt` | The most recent AI request and answer, for troubleshooting |
| `references\`, `icons\`, `functions\` | The user's own notes, pictures, icons and My functions |
| `bridge.ini` | Port and random token of the local connection below |

## Network

| Connection | When |
|---|---|
| `127.0.0.1` (this PC only) between the app and its helper, with a random token (`src/main/bridge.js`) | Always, while running |
| `https://api.anthropic.com` | Only when the user runs an AI tool or tests the key |
| Web pages (reference links, Radiopaedia, PubMed, Google, OpenEvidence), opened in the user's browser | Only when the user picks one |

Nothing else: no analytics, no telemetry, no update checks. The local
connection listens on `127.0.0.1` only, so other computers cannot reach it.

## Other things a scan will notice

- **Start with Windows** is optional and per user (the standard
  `HKCU\...\Run` entry Electron writes).
- **The installer** runs `build/rg-close.ps1` with PowerShell (execution
  policy bypassed for that one script) to close a running copy before it
  updates or uninstalls: it asks the app to quit, then ends any process
  still running from the install folder.
- `ahk/` holds an older prototype script, kept for reference; it is not part
  of the installed app.

## Reporting a problem

Open an issue on this repository, or contact Avecina Studio.
