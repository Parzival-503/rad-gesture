# RadGesture

Sina's radiology tool hub. Hold **Ctrl+CapsLock** anywhere: a ring opens at the
mouse. Flick toward a tool and let go, or tap and click.

- **AI Tools**: Proofread, Impression, One-liner (4 flavors), Priors checklist, settings
- **Gallery**: reference links (Lung-RADS, Fleischner, LI-RADS, TI-RADS, ...), search copied text
- **PACS** and **Apps**: Rad Optimizer's shortcuts (window/level, measure, layouts, Epic, Teams...), while Rad Optimizer runs
- **Stopwatch**: start / stop a study in RadStopwatch

Scroll or click the center to switch rings. Edit the rings from the tray icon:
**Edit menu...**

## Install (Windows)

1. AutoHotkey v1.1 must be installed (it runs the helper).
2. Download https://github.com/Parzival-503/rad-gesture/releases/download/radgesture-latest/RadGesture-Setup.exe
   and run it. No admin needed.
3. First time: tray icon > **AI settings (API key)**, paste the Claude API key.

## For developers

See `CLAUDE.md`. `npm test`, `python3 tools/ahk_check.py`,
`node scripts/build-preview.js` (a clickable preview page).
