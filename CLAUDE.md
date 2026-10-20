# RadGesture: working notes for Claude

<!-- BEGIN radiology-family (identical in every radiology repo — if you change it, change it in all of them) -->
## The radiology family

This repo is one of Sina's radiology tools. They are built to work together and
are meant to be developed together, usually in one Claude Code cloud project
("Radiology") that clones all of them side by side. On Sina's Mac they live in
`~/Documents/Apps/Radiology/`.

| Repo (GitHub `Parzival-503/…`) | Folder | What it is | Stack |
|---|---|---|---|
| `rad-stopwatch` | `RadStopwatch` | Per-study timer, focus "par", daily goals and wellness card for the reading workstation; reads exam titles from PowerScribe | AutoHotkey **v1.1**, Windows only |
| `rad-base` | `radabase` | Personal StatDx-style reference site built from Obsidian notes | Node static-site build, deployed on Vercel |
| `rad-gesture` | `RadGesture` | **The hub, where new tools go.** Our own radial menu (hold Ctrl+CapsLock) drawn by an Electron app, over an AutoHotkey helper that holds the AI tools (proofread, prior checklist, one-liner, impression) and does all PowerScribe work. Also the shortcut gallery | Electron + AutoHotkey **v1.1**, Windows |
| `rad-proofread` | `RadProofread` | **Merged into RadGesture** (`helper/RadGestureHelper.ahk`). Keeps the last standalone script for reference | AutoHotkey **v1.1**, Windows only |
| `rad-oneliner` | `RadOneLiner` | **Merged into RadGesture.** Keeps the original standalone one-liner script for reference | AutoHotkey **v1.1**, Windows only |

`rad-gesture` used to be a fork of the Kando pie-menu app. Since v3 it is
Sina's own code, inspired by Kando and DragShift but sharing no code with them
(Kando's code stays in git history up to commit `a782b72`).

### Where the tools run

- The reading workstation is **Windows**, with **PowerScribe** for dictation.
  Sina dictates by voice, so long stretches without mouse or keyboard input are
  normal work, not idleness.
- Anything that touches PowerScribe should reuse what RadStopwatch already
  learned (its `CLAUDE.md` has the full list). The two that cost the most:
  use PostMessage, never SendMessage, and never send raw Win32 messages to
  PowerScribe's report editor, which crashes it.
- AutoHotkey cannot run in a cloud session or on the Mac. Before handing over
  an `.ahk` edit, run whatever static checks the repo has (RadStopwatch:
  `tools/ahk_check.py`). New AHK tools should copy that checker, not start from
  nothing.

### Working across repos

- Before building something, check whether a sibling repo already solved it
  (PowerScribe reading, window detection, CSV logging, dashboards) and reuse
  that approach instead of inventing a second one.
- A change that affects how two tools fit together has to land in both repos
  in the same session, with a matching commit message in each.
- Each repo keeps its own detailed `CLAUDE.md`. This block is only the shared
  map. Keep it identical everywhere.

### Patient data: hard rule

**No real patient information goes into any repo, commit, test file, prompt or
chat.** That includes names, MRNs, accession numbers, dates of birth and real
report text. Use invented or fully de-identified samples. If Sina pastes
something that looks like real patient data, stop and tell him before using it.

This rule is about **development**: code, tests, commits, and chats with
Claude. It does not cover the report text a tool sends to the Claude API at
runtime on the workstation; that is what RadProofread is for. Whether that is
allowed is a hospital approval question for Sina, not a reason to refuse the
work.
<!-- END radiology-family -->

## This repo: the hub

Two parts, each doing what it is best at:

| Part | Where | Job |
|---|---|---|
| **Hub** | `src/` (Electron, plain JS, no bundler) | Draws the ring, opens links and files, reads `menu.json`, tray icon |
| **Helper** | `helper/RadGestureHelper.ahk` (AutoHotkey v1.1) | Owns Ctrl+CapsLock, does all typing / copying / PowerScribe work, holds the AI tools (proofread, prior checklist, one-liner, impression) |

They talk over `http://127.0.0.1:<port>` with a token (`src/main/bridge.js`,
"HUB BRIDGE" in the helper). The hub writes `%APPDATA%\RadGesture\bridge.ini`;
the helper reads it. Plain-text replies, because AHK v1 has no JSON.

### Before handing over ANY change

```
npm test                                          # ring geometry, menu, bridge, menu-to-helper cross-check
python3 tools/ahk_check.py                        # helper static checks, must print PASS
node scripts/build-preview.js && node scripts/preview.js   # ring flows + screenshots in scripts/shots/
xvfb-run -a node scripts/smoke.js                 # the real Electron app, driven over the bridge
```

`npm test` includes a check that every `helper:<id>` in the default menu has a
branch in the helper's `RunHubAction()`. Add a tool = add both, or it fails.
The AHK rules from rad-stopwatch's CLAUDE.md all apply to the helper.

The ring is a web page, so unlike the AHK tools it CAN be checked in the cloud:
`scripts/preview.js` screenshots it in Chromium. Look at the screenshots
before handing over any visual change. (Headless Linux can't capture the real
transparent window; `smoke.js` asserts on the DOM instead, and
`RG_SMOKE_OPAQUE=1` gives an opaque window you can screenshot.)

### How the ring works (`src/renderer/ring.js`)

- **Flick**: hold the trigger, move toward a direction, release. Moving past a
  direction that has `items` opens its smaller ring there (Kando's idea), so a
  whole path is one stroke. Direction is all that counts, not distance.
- **Tap**: released within 320 ms with nothing aimed at = the ring stays open
  for clicking.
- **Center** switches category (DragShift's idea): click it or scroll. In a
  smaller ring the center or the arrow goes back; right-click goes back too.
- Max 8 directions per ring (validated): more stops being flickable.
- A smaller ring reserves one slot pointing back at its parent, so the way back
  is always where you came from.
- The overlay window is `focusable: false` (WS_EX_NOACTIVATE) and shown with
  `showInactive()`: it must never take focus, or dictation lands in the wrong
  window. The helper runs a picked tool right after release, while PowerScribe
  is still the active window.

### The menu (`config/default-menu.json` -> `%APPDATA%\RadGesture\menu.json`)

The default is copied on first run; Sina edits his copy (tray > Edit menu) and
the hub reloads it on save. A broken file is reported and the last good menu
kept. Actions: `helper:<id>`, `url:`, `file:` (expands `%VARS%`), `search:`
(`{clipboard}` = copied text), `hub:edit-menu|open-folder|reload-menu`.
`apps` on a category picks which ring opens first over that program.
Icons are hand-drawn in `src/renderer/icons.js`; add one there, then use its
name.

The Gallery category carries over Sina's reference links from the old Kando
gallery (Lung-RADS, Fleischner, LI-RADS, ...).

### Helper notes

- Settings, API key, history: `%APPDATA%\RadGesture\` (`RadGesture.ini`). The
  install folder is replaced on every update, so nothing is stored there.
  `MigrateOldSettings()` copies a `RadProofread.ini` sitting next to the
  script, but in an installed hub there usually isn't one: Sina re-enters the
  key once (tray > AI settings).
- `#Requires AutoHotkey v1.1.33+` so AutoHotkey v2's launcher runs it with v1.
- The hub starts the helper from the AutoHotkey install it finds
  (`findAutoHotkey()` in main.js), falling back to the `.ahk` file association.
- Stopwatch slices send keys with `SendLevel 1` so RadStopwatch's own hotkeys
  (F4 start, F12 stop) see them.
- `WinHttp.SetProxy(1)`: a hospital WinHTTP proxy must not swallow localhost.

### Build

`.github/workflows/build-windows.yml` runs the checks, then builds
`RadGesture-Setup-<version>.exe` (one-click, per-user, no admin) and a portable
zip on a Windows runner, on every push. Download from the run's artifacts.
Building the installer locally needs Windows (or wine); the zip builds anywhere.

### Not here, on purpose

RadStopwatch stays its own program; the Stopwatch ring just sends its keys.

<!-- BEGIN wrap-skill (synced by sync-wrap-skill.sh — do not hand-edit) -->
## Close working sessions with a wrap summary

When you finish a substantive piece of work — code written, changed, reviewed,
debugged, or investigated — and you are handing back to Sina, **close your reply
with the summary defined in the `wrap` skill**, committed at
`.claude/skills/wrap/SKILL.md`. Invoke it with the Skill tool (`wrap`) and follow
it exactly.

This is a rule, not a judgment call about whether the work "deserves" a summary.
If files changed, he gets a wrap.

**Skip it** for quick factual answers, single lookups, status checks, and
conversational replies where nothing was built or changed. A wrap on a one-line
answer is noise.

Sina is the non-technical owner of this project. Everything above the summary is
your working-out — tool calls, diffs, reasoning. He should not have to read it to
know what happened. The wrap is the part he actually reads, so it has to be in
plain language, honest about what was and wasn't verified, and scannable.
<!-- END wrap-skill -->
