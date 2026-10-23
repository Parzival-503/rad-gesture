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
| `rad-evidence` | `RadEvidence` | Guideline library (ACR RADS, Fleischner, incidental-findings white papers, SRU/SAR statements) with a Claude Q&A that answers only from it and cites document + page; a scheduled watcher proposes new guidelines as pull requests | Python, local web page (`python -m radev serve`); GitHub Actions for the watcher |

`rad-gesture` used to be a fork of the Kando pie-menu app. Since v3 it is
Sina's own code, inspired by Kando and DragShift but sharing no code with them
(Kando's code stays in git history up to commit `a782b72`).
(Planned, not built: an "Ask the guidelines" ring item in RadGesture that sends
selected text to RadEvidence's local page, `http://127.0.0.1:8765/?q=...`.)

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
| **Hub** | `src/` (Electron, plain JS, no bundler) | The ring, the tray, the Settings window, links/files, keeps the helper alive |
| **Helper** | `helper/RadGestureHelper.ahk` (AutoHotkey v1.1), shipped **compiled** as `RadGestureHelper.exe` | Owns Ctrl+CapsLock, does all typing / copying / PowerScribe work, holds the AI tools and Lung-RADS |

They talk over `http://127.0.0.1:<port>` with a token (`src/main/bridge.js`,
"HUB BRIDGE" in the helper). The hub writes `%APPDATA%\RadGesture\bridge.ini`;
the helper reads it. Plain-text replies, because AHK v1 has no JSON. The
helper's poll (every 750 ms) is the heartbeat: "connected" in Status means
Ctrl+CapsLock will work. After every action it POSTs `/done?action=...`.

### Lesson from the first draft (don't repeat it)

v3.0's first build was unusable on the workstation: the hub looked for an
installed AutoHotkey to start the helper, failed silently, so Ctrl+CapsLock
and every helper-backed menu item did nothing, and the tray's "Edit menu"
opened a JSON file. Rules since:

- The helper is **compiled into the app** by CI (Ahk2Exe) and supervised by
  `helper-supervisor.js` (restarts with back-off, captures errors, AHK
  fallback with `/ErrorStdOut`). Its state is always visible (tray line,
  Settings > Status, sidebar dot).
- **One helper, always the tracked one.** The supervisor ignores a late
  exit from a copy it already replaced (that race once nulled the new child
  and chained restarts, leaving an untracked helper with a frozen Priors
  toolbar and "exit code 0" in Status), and kills stray
  RadGestureHelper.exe before each start. The helper's tray Reload exits
  for the hub to restart it (never AHK `Reload`), and its Quit asks the hub
  to quit. `test/supervisor.test.js`.
- **No user-facing JSON or folders.** Everything goes through the Settings
  window (`src/settings/`). The data folder is only an "advanced" button.
- **Nothing ships without the Windows e2e passing** (below): real AutoHotkey
  loads the helper, the compiled helper starts, injected Ctrl+CapsLock opens
  the ring and a flick and a tap-click both reach the helper.

### Before handing over ANY change

```
npm test                                          # unit tests (geometry, menu, bridge, settings store, ini, hotkeys, conflicts, menu<->helper)
python3 tools/ahk_check.py                        # helper static checks, must print PASS
python3 tools/hotkey_audit.py                     # shortcut clashes across ALL workstation scripts; rewrites docs/shortcuts.md
node scripts/build-preview.js && node scripts/preview.js   # ring flows + screenshots in scripts/shots/
xvfb-run -a node tests-e2e/run.js                 # the real app: tray items, every Settings page + saves, ring  (screens in e2e-shots/)
```

Then push and read the **Windows** job of `.github/workflows/build-windows.yml`
(GitHub MCP `get_job_logs`): it runs `tests-e2e/run.js` against the packaged
app with the compiled helper and real key presses (`tests-e2e/inject.ahk`).
The installer is published only if that job passes.

`npm test` includes a check that every `helper:<id>` in the default menu has a
branch in the helper's `RunHubAction()`. Add a tool = add both, or it fails.
The AHK rules from rad-stopwatch's CLAUDE.md all apply to the helper.

### The ring (`src/renderer/ring.js`, theme in `ring.css`)

Every element stays alive while open and is moved each frame by springs
(slightly under-damped: the overshoot is what makes it feel alive). Look at
screenshots before handing over any visual change.

- Rim pointer follows the cursor; directions zoom with closeness of aim;
  the aimed one fills with the ring's colour and its icon fills in.
- **Flick**: hold, move, release. The aimed direction stretches after the
  hand; moving past a direction with `items` opens its smaller ring there.
- **Tap** (<320 ms, nothing aimed) keeps it open for clicking.
- **Moving past** a direction that holds more opens it in both modes (Sina
  wants it; he missed it once v3 required a click after a tap). With the
  ring left open it waits `PASS_DWELL_MS` so crossing on the way to the dock
  opens nothing. Settings > General can turn it off (`passOpens: false`):
  then click, or let go on it.
- **Switching rings**: the dock (one button per ring, under the ring, above
  it near the bottom edge) jumps straight to any ring in one click; the wheel
  and a center click step one ring (right-click the center: back one). Sina
  asked for the dock: cycling with the center took four clicks. Settings >
  General can hide it (`dock: false`), which brings back the center dots.
  The dock keeps clear of every open ring (`placeDock`: below the lowest,
  else above the highest, else it steps aside); a smaller ring opened
  down-left/right used to land on it. `preview.js` checks for overlap.
- **Drag the center** to move the ring; a press is a click until it moves 6 px.
  Centers are hit-tested by position (`centerAt`), not DOM target: right
  after a switch the new directions spring out of the middle and would
  swallow the click. In a smaller ring the parent's shrunken center is the
  way back (aim at it or click it).
- Small dots around a direction preview its smaller ring's contents.
- Names: `labels` = `always` | `pause` (fade in after 650 ms still) | `never`;
  the center always shows the aimed name.
- Icons (`src/renderer/icons.js`): Material Symbols Rounded (`"spellcheck"`),
  Tabler Icons (`"ti:lungs"`, MIT, `tabler-icons.woff2` + `tabler-map.js`,
  5,247 icons), any emoji, or a picture (`"img:<file>"`): one the user added
  or a program's own icon, kept in `%APPDATA%\RadGesture\icons`
  (`src/main/icon-store.js`, shrunk to 96 px) and handed to the ring and
  Settings as data: URLs, so no page reads files outside the app. All
  bundled offline. Material names in the default menu and the suggested
  Tabler names are checked by tests.
- **Themes** (`src/common/themes.js`, one list for the ring, Settings and the
  picker in Settings > General): Graphite (default) plus seven neon/CRT
  looks. **All dark, no light theme, on purpose**: reading rooms are dark
  (Darkroom is red-only for dark-adapted eyes; Amber has no blue). A theme
  is CSS variables plus `lit` (`fill` / `outline`: neon looks glow instead
  of filling) and `fx` (`scan`, `pulse`, `glass`) that `ring.css` keys off.
  Neon themes colour rings from their palette unless `ringColors: "mine"`;
  use `T.ringColor(menu, i)` everywhere, never `category.color` directly.
  `scripts/preview.js` screenshots every theme (`9-theme-*.png`).
- **Smoothness rules**: never swap a gradient background on a state change
  (gradients can't transition, it snaps): the lit look is a `.node::before`
  layer (`--lit-bg`) that fades. The aimed-direction highlight glides between
  directions (`hlA` spring) with blurred edges, separators fade at both ends,
  and SVG ids are per level (`svgSeq`) since a shared `url(#id)` resolves to
  the first level's gradient. Settings colours derive from theme variables
  (`--well`, `--raise`); no hard-coded greys.
- The overlay is `focusable: false` + `showInactive()`; the hub delays hiding
  170 ms after a pick so the pick animation plays (the action already runs).

### Settings window (`src/settings/`)

Rings (visual editor: rings list, mini ring preview, directions list,
editor with icon picker / action type / key recorder with clash warnings,
Try it), AI tools (key + live test, model, proofread pickiness, impression
rules, priors), Shortcuts (below), Library (below), General (labels, size,
start with Windows, pause), Status (helper state + restart, old tools that clash + close them,
how to use, recent activity). `src/main/settings-store.js` maps it onto
`menu.json` and `RadGesture.ini`; a save tells the helper to `reload`.

### Open a program (`app:` actions)

A direction can open a program, shortcut, `.ahk` script or batch file
(RadStopwatch, Rad Optimizer, Epic...): `"action": "app:<path>"`, optional
`args`, `ifRunning: "new"` (default: bring the open window up instead of a
second copy), `startWithHub: true` (started, if not running, every time
RadGesture starts - `startPrograms()` waits for the helper). The hub turns it
into `run:<front|new|start>|<path>|<args>` (`runSpec` in `actions.js`) for the
helper's `RunProgram()`: `Process Exist` + `WinActivate` (un-minimises, never
un-maximises); a running `.ahk` is found by its hidden window and left alone,
since a second copy would ask to replace it. Without the helper the hub
starts it directly. Choosing a program in Settings also takes its icon
(`app.getFileIcon`). The Windows e2e opens Notepad through it twice.

### Library: Rad Optimizer's functions, built in

Sina's Rad Optimizer (an AutoHotkey script + a Supabase website that
generated it; the site is the free-org Supabase project "Radiology Workflow
Optimizer") is now part of RadGesture. Every function it had is a **library
function**: `config/library.json` (id = Rad Optimizer's function name, name,
group, description, default keyboard shortcut = Rad Optimizer's key, on/off
default, params) + its code in the helper's FUNCTION LIBRARY section
(`LibRun(id)`). No AutoHotkey script is generated: the helper runs them.

- **Two ways in**: a ring direction `helper:lib:<id>` (RunHubAction), and the
  function's own keyboard shortcut (`RegisterLibraryHotkeys`, bound BEFORE
  RadGesture's own so Proofread etc. win a clash). A mouse button or macro
  pad set to send Ctrl+Alt+P keeps doing Insert priors. A shortcut run POSTs
  `/done?action=lib-key:<id>`.
- **Params**: `key` = what the function presses inside Sectra/PowerScribe
  (Send syntax: `{;}`, `!o`, `^p`), `bool`, `list` (`|`-separated). Most
  functions are `target` functions (`sectra` = "Image Window", `powerscribe` =
  `ahk_exe Nuance.PowerScribe360.exe`): bring it up, press `Key`
  (`LibPress`; says so instead of typing into the wrong window when the
  program is closed). Insert priors / Paste indication / Lung screening 2 /
  dictation / logins / Epic / Teams / websites / search are their own code.
- **Settings**: `RadGesture.ini [Lib.<id>]` On, Hotkey, params; `Target` is
  rewritten from the JSON every start (`syncLibrary()`, before the helper
  starts, fills in every default). `[Library] Username`. **The password is
  never stored** (asked once per session, in memory, `LibPassword`); no
  username, password or work link (kp.org, SharePoint, OneDrive) goes in the
  repo: this repo is public. `test/library.test.js` checks that.
- **Off by default** (Sina): Dictate (F8 = Sectra's Dictate button, which opens
  the exam in PowerScribe; then PowerScribe is brought up and F4 toggles the
  microphone), Paste indication (needs a selection made by hand; not on the
  ring), the logins. Everything else is on with Rad Optimizer's keys.
- Settings > Functions: the "set the keys in Sectra first" card (colleagues'
  Sectra differs; Sina asked for that note), one entry per function
  (shortcut switch + recorder, the keys it presses, where it is on the
  rings, Try it, its code via `src/main/library-code.js`), username, websites.
  The ring editor has a "Library function" type with the same key note.
- Saved menus: migration `library` turns a direction pressing exactly Rad
  Optimizer's key (`helper:keys:^!2`) into `helper:lib:PACS_WL_Lung`; keys a
  person chose for their own Sectra stay key presses.
- A running Rad Optimizer (script or compiled `*optimizer*.exe`) is a clash
  in Status (and on the Library page) once any library shortcut is on.
- Adding a built-in function: an entry in library.json, its id in
  `LIB_IDS`, a branch in `LibRun` (unless it is a `target` function), a line
  in `library-code.js` CODE_FUNCS. The tests fail until all are there.
  Step by step for people: `docs/adding-functions.md`.
- **My functions** (Sina: "people can add new script functions, like Rad
  Optimizer's website"): written in Settings > Functions, stored as
  `%APPDATA%\RadGesture\functions\<id>.ahk` (id `my[a-z0-9]+`, wrapped by
  `wrapCustom` with UTF-8 BOM) + `[Lib.<id>] Custom=1, Name, Description, On,
  Hotkey` and `[Library] Custom=id|id`. The helper runs each as its own
  process with the AutoHotkeyU64.exe CI copies next to the helper
  (`LibRunCustom` / `LibAutoHotkey`; uncompiled: `A_AhkPath`), so a broken one
  shows AutoHotkey's error and never stops the helper. **Copy** on a target
  function starts one from it. Export/Import carry them (`set.functions`,
  code included; import never runs them). The Windows e2e writes one and
  checks it ran.

**Nothing that ships mentions a person or the project's history** (Sina,
2026-10-23: colleagues will read it). Comments in the helper, src/, config/
and the code shown by the "Code" button explain what the code does, never
who wanted it, which old script it came from, or "Change:" notes. Backstory
belongs here in CLAUDE.md. `test/library.test.js` fails on "Sina", old
version dates, "; Change:" or work links in shipped files.

**Names people see** (Sina, 2026-10-23): this page is **Functions** ("the
function collection"), never "Library": a library is reading material. The
ring of reading material is the **Reference Library** (it was "Gallery";
migration `reference-library` renames the shipped ring). Internal names
(`library.json`, `[Lib.<id>]`, `helper:lib:`, `[Library]`) stay, so saved
settings never move.

- **Search and filters** (`src/common/fnfilter.js`, tested): words ANDed
  over name/description/kind/rings/keys/code; a typed shortcut ("ctrl+alt+p",
  "alt+o", "F4") finds what listens for it or presses it; Find by key
  (recorder); group chips with counts; kind; works in (Sectra / PowerScribe /
  other, from `target` or `uses`); shortcut on/off/none; on a ring or not;
  clashes; sort by group / A-Z / shortcut; Detailed or Compact view (one line
  per function, opens in place). Clear filters keeps sort and view.
- **Are the shortcuts working?** After every start and reload the helper
  POSTs `lib-hotkeys:<count>:<failed>`; Functions and Status show it against
  how many are switched on (Sina once had none working and no way to tell).
  The Windows e2e checks the shipped ones are all on from the first start
  and that a real Ctrl+Alt+2 reaches Lung window.

### Reference Library (Settings > Reference Library, `ref:<id>`)

Sina: "a library is things you read". The ring of guideline links (once
"Gallery") is the **Reference Library**, and Settings > References holds his
own **notes** (Markdown underneath, shown formatted) and **pictures**
(screenshots), in `%APPDATA%\RadGesture\references\` (`index.json` + `<id>.md`
+ `<id>.png`; `src/main/references.js`, tested). Ways in: New note, Snip now
(`ms-screenclip:`, the snip is picked up from the clipboard within a minute),
Paste screenshot or text, Choose a picture, the ring's **Add from clipboard**
(`hub:ref-add`) and the tray. "Put on the ring" adds `ref:<id>` under the
Reference Library ring's **My notes** (made on first use). The ring opens it
in the **reference viewer** (`src/viewer/`, always on top, Esc closes, Edit
goes to Settings). Screenshots are kept at most 2400 px wide.

- `src/common/markdown.js` is ours, not a library, and **safe by
  construction**: everything is escaped, only its own tags come out, links
  only http(s)/mailto. Headings 1-4, a single line break stays a break,
  bold/italic/strike/==highlight==/code, nested and check lists, tables with
  alignment, `> **Pearl**` callouts, rules. The editor (Write / Side by side /
  Preview) re-renders the preview on every key, continues lists on Enter
  (Enter on an empty item ends it), Ctrl+B / Ctrl+I, and a toolbar.
- The page lists **everything** in the Reference Library: his notes and
  pictures, then the ring's guideline links (`url:` items of the `gallery`
  ring, grouped by the smaller ring they sit in; Sina could not find the
  shipped references there). Links are edited in place (name, address,
  section, icon, remove; "Add a link"); they live in the menu, so they need
  Save. Filters: All / Links / Notes / Pictures, sections and tags as chips.
- **"Reference Library", capital L** (a title, Sina). Migration
  `reference-library-title` fixes rings saved as "Reference library".
- Notes save themselves (450 ms after typing); there is no Save for them.
- **Electron 44's clipboard is asynchronous** (`readText()` and `read()`
  return promises; there is no `readImage`). Use `clipText()` / `clipImage()`
  in main.js. Reading it the old way made "Search copied text" search for
  "[object Promise]"; the e2e now checks the search URL.

### Shortcuts page (made so colleagues can use RadGesture)

Sina's PACS/Apps rings used to press Rad Optimizer's keys (now Library
functions, above); a colleague's Sectra has its own. So Settings > Shortcuts holds every key in one place: a 3-step
setup card (give tools keys in Sectra + **Copy the list**, match them here,
**Export / Import** a `.rgkeys` set), RadGesture's own shortcuts, and **every
`helper:keys:` direction** grouped by ring with its own recorder, search,
Defaults / Clear all, and warnings (two directions on one key, a key that is
also a RadGesture shortcut - the helper presses with SendLevel 1 so it would
fire it). Logic is `src/common/keyset.js` (tested): directions are matched
by their path of names on import, so a set survives a re-arranged ring.

The recorder (`recorder(spec, onSet, { plain })`) shows held modifiers live,
Esc cancels, Backspace clears. `plain: true` (keys the ring presses) takes a
single key, as Sectra's often are; RadGesture's own shortcuts need a modifier
or an F-key so they can't fire while typing. Recorded keys are stored in
Send syntax (`{F4}`, `^{Space}`, `{;}`) by `KS.hotkeyToSend`.

### Tray

Left-click: Settings. Right-click: Open the ring, Settings..., Edit rings...,
AI tools..., Shortcuts..., helper state line (click to start it), close
conflicting tools, Pause the ring, Start with Windows, Status and help...,
Quit (also stops the helper).

### The menu data (`config/default-menu.json` -> `%APPDATA%\RadGesture\menu.json`)

Actions: `helper:<id>`, `url:`, `file:` (expands `%VARS%`), `search:`
(`{clipboard}`), `hub:`, `ref:<id>` (a Reference Library note or picture). `apps` on a ring picks which ring opens first over
that program. The Reference Library ring (id `gallery`, once "Gallery") carries Sina's reference links from the old
Kando gallery. Edited only through Settings.

**Saved menus are migrated once** (`migrate()` in `settings-store.js`,
recorded in `menu.migrated`): installing keeps `menu.json`, so a change to
the default menu reaches existing users only through a step there. The
first one removes v3.0's Stopwatch ring while it is still the shipped one;
the second moves Orthogonal (a measuring tool) from Crosshair to Measure,
next to Distance; the third drops Paste indication (Rad Optimizer's Ctrl+Alt+G
only works on a selection made by hand, never from the ring); the fourth
(`library`) turns Rad Optimizer key presses into Library functions.

### Helper notes

- Settings, API key, history: `%APPDATA%\RadGesture\` (`RadGesture.ini`).
- `--selftest` runs the whole startup then prints `SELFTEST OK` and exits
  (CI). `reload`, `suspend`/`resume` come from Settings.
- `#Requires AutoHotkey v1.1.33+`; CI uses v1.1.37.02.
- Stopwatch slices send keys with `SendLevel 1` so RadStopwatch's own hotkeys
  (F4 start, F12 stop) see them.
- **Prior checklist** (ring: AI Tools > Priors): copy each prior report,
  **+ Add** (as many as needed), then **Checklist**; its window has
  **Insert into report** (pastes with Ctrl+V where the cursor is, then
  restores the clipboard; the window never takes focus) and Copy. The
  floating Priors toolbar shows at startup, as in RadProofread: the first v3
  builds hid it and Sina lost track of the tool (`migrateIni()` turned it
  back on once for INIs those builds wrote).
  Closing the toolbar (its X button, the title-bar X) hides it AND saves
  ShowAtStartup=0, so helper restarts don't bring it back; only Show toolbar
  (ring or tray) turns it on again. The Priors tools never pop it up on
  their own (an empty bin or nothing copied is a notification): Sina saw it
  appear "on Ctrl+CapsLock" and could not get rid of it.
- **Impression** (`ImpressionPrompt()`): a high-level SYNTHESIS, not a
  summary (Sina: the first one just reworded the findings). Answers the
  clinical question first, merges related findings, leaves out chronic and
  incidental findings that need no follow-up unless the history makes them
  relevant (gallstones only with pain), and then ends with "Additional
  chronic and incidental findings as described in the body of the report."
  It sends the text before FINDINGS: (history) too (`ImpressionContext`),
  at effort medium. Settings > AI tools can switch Impression alone to Opus
  5.5 (`[Impression] Model`); default is the shared model (Sonnet 5.5).
  A negative study is ONE line ("No acute findings in the chest."), never a
  list of answered negatives, and gets no closing line; the prompt carries
  that case as a wrong/right example because the first synthesis prompt
  still listed negatives, atelectasis and coronary calcification.
- `WinHttp.SetProxy(1)`: a hospital WinHTTP proxy must not swallow localhost.
- **Lung-RADS** (Alt+Shift+L, ring: PACS > PowerScribe) is Sina's standalone
  script merged unchanged. It CHANGES PowerScribe only by PostMessage, and asks
  the pick lists read-only questions (LB_FINDSTRINGEXACT, LB_GETCOUNT,
  LB_GETCURSEL, LB_GETITEMRECT) by SendMessage, because only SendMessage
  returns an answer. `ahk_check.py` enforces exactly that.

### Shortcuts

`tools/hotkey_audit.py` collects every hotkey on the workstation: the helper's
INI defaults, RadStopwatch (from `../rad-stopwatch` when checked out, else a
saved copy), the Library's default shortcuts (`config/library.json`) and
retired scripts like Rad Optimizer (keys only, in `tools/external_hotkeys.json`,
also bundled so Settings can warn about clashes). Fails on shared keys,
swallowed keys, ring buttons pressing unhandled keys, Windows-reserved
combos, Library buttons naming no function; writes `docs/shortcuts.md`.

### Build

`.github/workflows/build-windows.yml`: Linux checks + e2e, then Windows:
download AHK v1.1, selftest, compile the helper (and copy AutoHotkeyU64.exe
next to it for My functions), `npm run dist`, Windows e2e with real keys,
then publish to the `radgesture-latest` release (fixed links):
`.../releases/download/radgesture-latest/RadGesture-Setup.exe` (per-user
install, no admin) and `RadGesture-portable.zip` (nothing installed: unzip
and run `RadGesture.exe`, for PCs that block installers; same app, settings
in `%APPDATA%\RadGesture` either way).

**Closing the running app on install/uninstall** is ours, not
electron-builder's (`build/installer.nsh` calls `build/rg-close.ps1`; keep it
a file, an inline command passed NSIS's 1024-char string limit): ask it to
quit over the bridge (`POST /quit`), then force-close everything running
from the install folder (the rule an older version's uninstaller checks, so
it has nothing to trip on), wait until files can be opened, then a message
naming the tray Quit. Log: `%TEMP%\RadGesture-Setup.log`. The stock step showed
"RadGesture cannot be closed. Please close it manually" on Sina's PC, which
is what Windows does when the app runs as administrator and Setup does not;
the bridge request crosses that line, a kill does not. Settings > Status
warns when RadGesture runs elevated. `tests-e2e/installer.ps1` (Windows job)
installs over and uninstalls a running copy.

**AI models**: Sonnet 5.5 (default), Haiku 5.5, Opus 5.5 only; a retired
model in the INI reads back as Sonnet 5.5 (hub `readAI`, helper
`NormalizeModel`). They reject `temperature` and think before writing, so
the helper sends an effort level (`ApiExtras`) and at least 8000 max_tokens
(`ApiMaxTokens`).

**The API key** is typed only in Settings > AI tools (the helper's old
built-in box is a fallback when the hub is down; its "settings" opens the
hub over `/open-settings`). The helper re-reads it from the INI before every
call (`HaveKey`) - a copy held since startup went stale. Both sides clean
what was pasted (`src/common/apikey.js`, `CleanApiKey`) and say errors in
words. Helper windows say "RadGesture": a "RadProofread" title means the old
standalone script is running.

### Not here, on purpose

- **RadStopwatch** stays its own program and is not bundled. It is Sina's
  (his department's workload values, pay credits, reward bank), it keeps its
  data next to its script, and it has its own release rhythm; size was not
  the reason (about 1.5 MB compiled against a 117 MB installer). The default
  menu no longer has a Stopwatch ring: Sina launches it with an "Open a
  program" direction set to start with RadGesture, and can still add
  "Press keys" directions for F4 / F12.
- **Rad Optimizer** is not needed any more: its functions are the Library
  (above). Its old script is not in any repo (it held a username and work
  links). Ctrl+Alt+F4 (Library dictation, off by default) is shared with
  RadStopwatch's timer on purpose.

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
