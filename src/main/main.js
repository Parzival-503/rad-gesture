// RadGesture hub - Electron main process.
//
// One transparent, never-focused overlay window is created at startup and
// kept loaded, so the ring appears the instant the helper reports
// Ctrl+CapsLock. Everything that types or touches PowerScribe stays in the
// AutoHotkey helper; the hub draws the ring, opens links and files, and tells
// the helper what was picked.

const { app, BrowserWindow, Tray, Menu, screen, shell, clipboard, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createBridge } = require('./bridge');
const { resolveAction } = require('./actions');
const { validateMenu, categoryForApp } = require('../common/menu');

const PREFERRED_PORT = 47811;
const RELEASE_TIMEOUT_MS = 600;

// Tests run the real app against a throwaway settings folder.
if (process.env.RG_USER_DATA) app.setPath('userData', process.env.RG_USER_DATA);
if (process.env.RG_SMOKE) app.disableHardwareAcceleration(); // headless test display has no GPU
if (!app.requestSingleInstanceLock()) app.quit();

const userDir = () => app.getPath('userData'); // %APPDATA%\RadGesture
const menuPath = () => path.join(userDir(), 'menu.json');
const defaultMenuPath = path.join(__dirname, '..', '..', 'config', 'default-menu.json');
const helperPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'helper', 'RadGestureHelper.ahk')
    : path.join(__dirname, '..', '..', 'helper', 'RadGestureHelper.ahk');

let overlay = null;
let tray = null;
let bridge = null;
let menu = null;
let ringOpen = false;
let releaseSeq = 0;
const releaseWaiters = new Map();

// ---------------------------------------------------------------- menu file

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'RadGesture', body }).show();
}

function loadMenu() {
  if (!fs.existsSync(menuPath())) {
    fs.mkdirSync(userDir(), { recursive: true });
    // read + write, not copyFile: the default lives inside the app's packed bundle
    fs.writeFileSync(menuPath(), fs.readFileSync(defaultMenuPath, 'utf8'));
  }
  try {
    const next = JSON.parse(fs.readFileSync(menuPath(), 'utf8'));
    const v = validateMenu(next);
    if (!v.ok) throw new Error(v.errors.slice(0, 3).join('; '));
    menu = next;
    return true;
  } catch (e) {
    // Keep the last good menu (or the default) rather than leaving no ring.
    if (!menu) menu = JSON.parse(fs.readFileSync(defaultMenuPath, 'utf8'));
    if (process.env.RG_SMOKE) console.log('SMOKE menu rejected: ' + e.message);
    notify('menu.json has a problem, keeping the previous menu: ' + e.message);
    return false;
  }
}

function watchMenu() {
  let t = null;
  fs.watch(userDir(), (evt, file) => {
    if (file !== 'menu.json') return;
    clearTimeout(t);
    t = setTimeout(() => loadMenu() && notify('Menu reloaded'), 300);
  });
}

// ---------------------------------------------------------------- the ring

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    // RG_SMOKE_OPAQUE: screenshot test only - headless displays can't capture transparent windows.
    transparent: !process.env.RG_SMOKE_OPAQUE,
    backgroundColor: process.env.RG_SMOKE_OPAQUE ? '#3a3f48' : '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false, // WS_EX_NOACTIVATE on Windows: dictation stays in PowerScribe
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// mode 'hold': opened by the trigger, released by it (flick). 'click': opened
// from the tray or a second launch, where nothing is held.
function openRing(exe, mode = 'hold') {
  if (process.env.RG_SMOKE) console.log('SMOKE openRing');
  if (!overlay) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const b = display.bounds;
  overlay.setBounds(b);
  ringOpen = true;
  overlay.webContents.send('rg:open', {
    x: cursor.x - b.x,
    y: cursor.y - b.y,
    menu,
    category: categoryForApp(menu, exe),
    mode,
  });
  overlay.showInactive();
  if (process.env.RG_SMOKE) smokeReport();
}

// Smoke test only (scripts/smoke.js): report what the ring drew, and a picture.
function smokeReport() {
  setTimeout(async () => {
    const st = await overlay.webContents.executeJavaScript(
      'JSON.stringify((s => s && { levels: s.levels.length, cat: s.cat, items: s.levels[0].items.length,' +
        ' drawn: document.querySelectorAll(".level.current .item").length,' +
        ' center: Math.round(document.querySelector(".center").getBoundingClientRect().width) })(window.RGRing.state()))'
    );
    console.log('SMOKE ring ' + st + ' visible=' + overlay.isVisible() + ' focusable=' + overlay.isFocusable());
    try {
      const img = await overlay.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.RG_SMOKE, 'overlay.png'), img.toPNG());
    } catch (e) {
      console.log('SMOKE capture failed: ' + e.message); // headless displays sometimes can't
    }
    console.log('SMOKE captured');
  }, 500);
}

function hideRing() {
  ringOpen = false;
  if (overlay) overlay.webContents.send('rg:close');
  if (overlay && overlay.isVisible()) overlay.hide();
  for (const resolve of releaseWaiters.values()) resolve({ type: 'none' });
  releaseWaiters.clear();
}

// Runs a picked item. Returns the helper reply for a release ("action:<id>"
// or "none"); clicks queue helper actions for the helper's next poll.
function runItem(item, viaRelease) {
  const r = resolveAction(item.action, { env: process.env, clipboard: clipboard.readText() });
  switch (r.kind) {
    case 'helper':
      if (viaRelease) return 'action:' + r.value;
      bridge.enqueue(r.value);
      return 'none';
    case 'url':
      shell.openExternal(r.value);
      return 'none';
    case 'file':
      shell.openPath(r.value).then((err) => err && notify(`Could not open ${r.value}: ${err}`));
      return 'none';
    case 'hub':
      hubCommand(r.value);
      return 'none';
    default:
      notify(`Unknown action "${item.action}" - check menu.json`);
      return 'none';
  }
}

function hubCommand(id) {
  if (id === 'edit-menu') shell.openPath(menuPath());
  else if (id === 'open-folder') shell.openPath(userDir());
  else if (id === 'reload-menu') loadMenu() && notify('Menu reloaded');
  else notify(`Unknown hub command "${id}"`);
}

function askRendererForRelease() {
  return new Promise((resolve) => {
    const id = ++releaseSeq;
    releaseWaiters.set(id, resolve);
    overlay.webContents.send('rg:release', { id });
    setTimeout(() => {
      if (releaseWaiters.delete(id)) resolve({ type: 'none' });
    }, RELEASE_TIMEOUT_MS);
  });
}

ipcMain.on('rg:release-result', (_e, { id, result }) => {
  const resolve = releaseWaiters.get(id);
  if (resolve) {
    releaseWaiters.delete(id);
    resolve(result);
  }
});
ipcMain.on('rg:select', (_e, item) => {
  hideRing();
  runItem(item, false);
});
ipcMain.on('rg:dismiss', () => hideRing());

// ---------------------------------------------------------------- bridge

function bridgeToken() {
  const file = path.join(userDir(), 'bridge.ini');
  if (fs.existsSync(file)) {
    const m = fs.readFileSync(file, 'utf8').match(/^Token=([0-9a-f]{32})\s*$/m);
    if (m) return m[1];
  }
  return crypto.randomBytes(16).toString('hex');
}

async function startBridge() {
  const token = bridgeToken();
  bridge = createBridge({
    token,
    onShow: (exe) => openRing(exe),
    onRelease: async () => {
      if (!ringOpen) return 'none';
      const result = await askRendererForRelease();
      if (result.type === 'stay') return 'stay';
      hideRing();
      return result.type === 'select' ? runItem(result.item, true) : 'none';
    },
    onCancel: () => hideRing(),
    isOpen: () => ringOpen,
  });
  const port = await bridge.listen(PREFERRED_PORT);
  // The helper reads this to find us. The token never changes once made.
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(path.join(userDir(), 'bridge.ini'), `[Bridge]\r\nPort=${port}\r\nToken=${token}\r\n`);
}

// ---------------------------------------------------------------- helper

function findAutoHotkey() {
  const configured = menu.helper && menu.helper.ahkPath;
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs')]
    .filter(Boolean)
    .map((r) => path.join(r, 'AutoHotkey'));
  const candidates = [configured];
  for (const r of roots) {
    candidates.push(path.join(r, 'AutoHotkeyU64.exe'), path.join(r, 'AutoHotkey.exe'));
    // AutoHotkey v2's installer keeps v1.1 in a versioned subfolder.
    try {
      for (const d of fs.readdirSync(r).filter((d) => /^v1\.1/.test(d)).sort().reverse()) {
        candidates.push(path.join(r, d, 'AutoHotkeyU64.exe'), path.join(r, d, 'AutoHotkey.exe'));
      }
    } catch (_) {}
  }
  return candidates.find((c) => c && fs.existsSync(c));
}

function startHelper() {
  if (process.platform !== 'win32') return;
  const script = helperPath();
  const exe = findAutoHotkey();
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  // Falls back to the .ahk file association if AutoHotkey isn't where we look.
  const child = exe ? spawn(exe, [script], opts) : spawn('cmd.exe', ['/c', 'start', '""', script], opts);
  child.on('error', (e) => notify('Could not start the helper (is AutoHotkey v1.1 installed?): ' + e.message));
  child.unref();
}

// ---------------------------------------------------------------- tray

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('RadGesture - hold Ctrl+CapsLock');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show the ring here (test)', click: () => openRing('', 'click') },
      { type: 'separator' },
      { label: 'Edit menu...', click: () => hubCommand('edit-menu') },
      { label: 'Open settings folder', click: () => hubCommand('open-folder') },
      { label: 'Reload menu', click: () => hubCommand('reload-menu') },
      { type: 'separator' },
      { label: 'AI settings (API key)', click: () => bridge.enqueue('settings') },
      { label: 'Proofread history', click: () => bridge.enqueue('history') },
      { label: 'Restart helper', click: () => startHelper() },
      { type: 'separator' },
      { label: 'Quit RadGesture', click: () => app.quit() },
    ])
  );
}

// ---------------------------------------------------------------- start

if (process.platform === 'win32') app.setAppUserModelId('menu.radgesture.hub'); // Windows notifications need it

app.whenReady().then(async () => {
  loadMenu();
  watchMenu();
  createOverlay();
  await startBridge();
  buildTray();
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: menu.startAtLogin !== false });
  if (!menu.helper || menu.helper.autoStart !== false) startHelper();
});

app.on('second-instance', () => openRing('', 'click'));
app.on('window-all-closed', (e) => e.preventDefault()); // tray app: keep running
