# Adding functions to RadGesture

RadGesture's **function collection** (Settings > Functions) is where Rad Optimizer's
functions live: one entry per function, with what it does, its keyboard
shortcut, and the key it presses inside Sectra or PowerScribe. There are two
ways to add to it.

| | **My functions** | **A built-in function** |
|---|---|---|
| Who | Anyone, in Settings. No coding tools needed | Someone changing RadGesture itself (a developer, or Claude) |
| Where it lives | Your PC (`%APPDATA%\RadGesture\functions\`) | This repo, for everyone who installs RadGesture |
| Share it | Shortcuts > Export / Import | Ships with the next build |

---

## 1. My functions (in Settings)

1. Settings > **Functions**, scroll to **My functions**, press **New function**.
   (Or press **Copy** on any PACS / PowerScribe function to start from it.)
2. Give it a **name** and a line on **what it does** (colleagues see this).
3. Write its **AutoHotkey v1.1 code**. It runs top to bottom each time.
4. **Save** (bottom bar), then **Try it**.
5. Use it:
   - **On the ring**: Settings > Rings > pick a direction > **Library
     function** > choose it under "My functions".
   - **From a key, mouse button or macro pad**: switch on its **Keyboard
     shortcut** and record one (for a mouse button, set the mouse's software to
     send that same shortcut).

**Before it works for a colleague, the keys must already be set up in their
Sectra/PowerScribe.** A function that presses Alt+O only works where Alt+O is
the tool you mean.

### Examples

Bring up Sectra and press its orthogonal key:

```ahk
WinActivate, Image Window
WinWaitActive, Image Window, , 1
Send, !o
```

Type a phrase into PowerScribe:

```ahk
WinActivate, ahk_exe Nuance.PowerScribe360.exe
WinWaitActive, ahk_exe Nuance.PowerScribe360.exe, , 1
SendRaw, No acute findings.
```

Open two websites:

```ahk
Run, https://radiopaedia.org
Run, https://app.statdx.com
```

### Good to know

- Sectra's image window is `Image Window`; PowerScribe is
  `ahk_exe Nuance.PowerScribe360.exe`.
- Each function runs as **its own small program** (RadGesture ships
  AutoHotkey for this). A mistake shows AutoHotkey's error box with the line
  number; it never stops RadGesture.
- **Never put a password in a function**: it would be saved in a plain file
  and travel with every export. Use the Library's login functions (the
  password is asked once per session and never saved).
- **Never send messages to PowerScribe's report editor** (SendMessage /
  PostMessage to its RichEdit): it crashes PowerScribe. Keys, the clipboard
  and the field list are fine.
- **Sharing**: Shortcuts > Export puts your functions (with their code) in the
  `.rgkeys` file; Import adds a colleague's. A function can do anything a
  program can, so only import from people you trust, and read the code in
  Library before you press Save.

---

## 2. A built-in function (in this repo)

For a function everyone should get. The tests fail until every step is done.

1. **`config/library.json`**: add an entry.
   - `id` (the name used everywhere; Rad Optimizer's own function names were
     kept), `name`, `group` (one of `groups`), `sub`, `description`, `icon`
     (a Material Symbols name).
   - `hotkey`: its default keyboard shortcut (AutoHotkey spelling, `^!x` =
     Ctrl+Alt+X; check `docs/shortcuts.md` for free ones), and `on`: whether
     that shortcut starts switched on.
   - `params`: settings a person can change. `key` = a key it presses in
     Sectra/PowerScribe (Send spelling: `!o`, `{F4}`, `{;}`), `bool`, `list`.
   - **Just "bring a program up and press a key"?** Add `"target": "sectra"`
     (or `"powerscribe"`) and a `Key` param. That is the whole function; skip
     steps 2-3.
2. **`helper/RadGestureHelper.ahk`**, FUNCTION LIBRARY section: add the id
   to `LIB_IDS`, a branch in `LibRun`, and a `Lib_<Name>()` function. Read
   settings with `LibParam(id, "Key")`, report with `Notify()`, mark anything
   changed from the original code with a `; Change:` comment.
3. **`src/main/library-code.js`**: add it to `CODE_FUNCS` (for the "Code"
   button).
4. Optional: put it on a ring in `config/default-menu.json`
   (`"action": "helper:lib:<id>"`).
5. Run the checks in `CLAUDE.md` ("Before handing over ANY change"), then push:
   the Windows build tests it with real AutoHotkey before publishing.

Rules for helper code (they broke things before): no SendMessage except the
four read-only list questions, nothing ever sent to PowerScribe's report
editor, no passwords, usernames or work links in the repo (it is public).
