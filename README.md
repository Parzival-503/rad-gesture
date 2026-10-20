# RadGesture

Sina's radiology tool hub. Hold **Ctrl+CapsLock** anywhere: a ring opens at the
mouse. Flick toward a tool and let go, or tap and click.

- **AI Tools**: Proofread, Impression, One-liner (4 flavors), Priors checklist
- **PACS** and **Apps**: Rad Optimizer's shortcuts (needs Rad Optimizer running), Lung-RADS
- **Gallery**: reference links (Lung-RADS, Fleischner, LI-RADS, TI-RADS, ...), search copied text
- **Stopwatch**: start / stop a study in RadStopwatch

Scroll or click the center to switch rings.

## Install (Windows)

1. Quit the **old** RadGesture (the Kando one) and the standalone RadProofread /
   RadOneLiner / Lung-RADS scripts if they are running. They grab the same keys.
   (The new one also finds them for you: Settings > Status.)
2. Download https://github.com/Parzival-503/rad-gesture/releases/download/radgesture-latest/RadGesture-Setup.exe
   and run it. No admin needed, nothing else to install.
3. Settings opens. Go to **AI tools**, paste the Claude API key, press **Test**.

Everything after that is in Settings (left-click the tray icon) or the tray
icon's right-click menu: edit rings, change shortcuts, pause, start with Windows.

## For developers

See `CLAUDE.md`. Every shortcut on the workstation, and which are free:
`docs/shortcuts.md`. Each push builds and tests the installer on a real Windows
machine (`.github/workflows/build-windows.yml`).
