# RadGesture

Sina's radiology tool hub. Hold **Ctrl+CapsLock** anywhere: a ring opens at the
mouse. Flick toward a tool and let go, or tap and click.

- **AI Tools**: Proofread, Impression, One-liner (4 flavors; collect several parts of a chart first with **Add chart text**, the bin empties itself after), Priors checklist
- **PACS** and **Apps**: Rad Optimizer's functions, now built in (Settings > Functions; Rad Optimizer is no longer needed), Lung-RADS
- **Reference Library** (was "Gallery"): reference links (Lung-RADS, Fleischner, LI-RADS, TI-RADS, ...), search copied text

Scroll or click the center to switch rings.

## Install (Windows)

1. Quit the **old** RadGesture (the Kando one) and the standalone RadProofread /
   RadOneLiner / Lung-RADS scripts if they are running. They grab the same keys.
   (The new one also finds them for you: Settings > Status.)
2. Download https://github.com/Parzival-503/rad-gesture/releases/download/radgesture-latest/RadGesture-Setup.exe
   and run it. No admin needed, nothing else to install.

   **PC blocks installers?** Download
   https://github.com/Parzival-503/rad-gesture/releases/download/radgesture-latest/RadGesture-portable.zip
   instead: unzip it somewhere permanent (e.g. `Documents\RadGesture`) and open
   `RadGesture.exe`. Same app, nothing installed. To update, quit it from the
   tray and replace the folder; your rings and settings are kept.
   (A PC that only runs IT-approved programs blocks both; that needs IT.)
3. Settings opens. Go to **AI tools**, paste the Claude API key, press **Test**.

Everything after that is in Settings (left-click the tray icon) or the tray
icon's right-click menu: edit rings, change shortcuts, pause, start with Windows.

## Giving it to a colleague

Their PACS has its own keys, so after installing:

1. Settings > **Functions** > **Copy the list**: the key each function presses
   in Sectra or PowerScribe (window/level, measure, layouts, insert priors...).
2. In Sectra, give those tools keys (or keep Sectra's own), then in Functions
   record the same key for each. Single keys are fine.
3. Or skip both: **Import** a `.rgkeys` file someone already made with
   **Export** (one per department is enough).

Rings they don't need can be deleted in Settings > Rings.

## Your own buttons

In Settings > Rings, a direction can **open a program** (an app, shortcut or
AutoHotkey script; it brings the window up if it is already open, and can
start with RadGesture), and its icon can be any of about 9,000 bundled icons
(Material and Tabler), an emoji, or a picture of your own.

## Your own functions (like the Rad Optimizer website)

Settings > **Functions** holds every Rad Optimizer function, each with its
description, its keyboard shortcut and the key it presses in Sectra. At the
bottom, **My functions** > **New function**: give it a name, write its
AutoHotkey code, then put it on a ring (Rings > a direction > Function) or give it a keyboard shortcut. **Copy** on a PACS or PowerScribe
function starts one from it. Share them with Shortcuts > **Export**. Step by
step, with examples: [docs/adding-functions.md](docs/adding-functions.md).

## Reference Library: your own notes and screenshots

Settings > **References**: **New note** (headings, bold, lists, check lists,
tables and pearls, shown formatted as you type; a toolbar does it for you),
**Snip now** (Windows' snipping; the snip is added by itself), **Paste
screenshot or text**, or **Choose a picture**. Tag them, search them, then
**Put on the ring**: they open in a clean window over whatever you read. Fastest
of all: copy something, then ring > Reference Library > **Add from
clipboard** (or the tray). Keep patient details out of screenshots.

## Themes

Settings > **General** > Theme: Graphite (the calm default) or one of seven
neon looks, all dark for a reading room: Synthwave, Grid, Phosphor (green
terminal), Amber (no blue light), Abyss, Darkroom (red only, keeps your eyes
dark-adapted) and Hologram. The neon themes colour the rings for you; choose
"My own" under Ring colours to keep yours.

## For developers

See `CLAUDE.md`. Every shortcut on the workstation, and which are free:
`docs/shortcuts.md`. Each push builds and tests the installer on a real Windows
machine (`.github/workflows/build-windows.yml`).
