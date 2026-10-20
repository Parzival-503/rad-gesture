// RadGesture hub - Electron main process.
//
//  - overlay: one transparent, never-focused window, kept loaded, that shows
//    the ring the instant the helper reports Ctrl+CapsLock;
//  - helper: the AutoHotkey part (keys, PowerScribe, AI tools), started and
//    kept alive by helper-supervisor.js;
//  - tray: left-click opens Settings, right-click has the full menu;
//  - Settings window: rings, AI tools, shortcuts, general, status. Nothing is
//    ever edited by hand in a file.

const { app, BrowserWindow, Tray, Menu, screen, shell, clipboard, ipcMain, nativeImage, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createBridge } = require('./bridge');
const { resolveAction } = require('./actions');
const { createStore, MODELS } = require('./settings-store');
const { createSupervisor } = require('./helper-supervisor');
const conflicts = require('./conflicts');
const { categoryForApp } = require('../common/menu');

const PREFERRED_PORT = 47811;
const RELEASE_TIMEOUT_MS = 600;
const HIDE_AFTER_PICK_MS = 170; // lets the ring's pick animation play
const E2E = !!process.env.RG_E2E;

if (process.env.RG_USER_DATA) app.setPath('userData', process.env.RG_USER_DATA);
if (process.env.RG_SMOKE) app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const ROOT = path.join(__dirname, '..', '..');
const userDir = () => app.getPath('userData');
const store = createStore({ userDir, defaultMenuPath: path.join(ROOT, 'config', 'default-menu.json') });
const resourcesHelperDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'helper') : path.join(ROOT, 'helper'));

let overlay = null;
let overlayReady = false;
let pendingOpen = null;
let settingsWin = null;
let tray = null;
let bridge = null;
let supervisor = null;
let menu = null;
let ringOpen = false;
let paused = false;
let hideTimer = null;
let releaseSeq = 0;
let lastConflicts = [];
const releaseWaiters = new Map();
const events = []; // recent bridge events, for Settings > Status and the tests

function logEvent(type, detail = '') {
  events.push({ t: Date.now(), type, detail });
  if (events.length > 60) events.shift();
  if (E2E || process.env.RG_SMOKE) console.log(`RG ${type} ${detail}`);
}

function notify(body) {
  if (E2E) return logEvent('notify', body);
  if (Notification.isSupported()) new Notification({ title: 'RadGesture', body }).show();
}

// ---------------------------------------------------------------- menu

function loadMenu() {
  try {
    menu = store.readMenu();
    return true;
  } catch (e) {
    if (!menu) menu = store.defaultMenu();
    notify('Your rings could not be read, so the last good version is in use: ' + e.message);
    logEvent('menu-rejected', e.message);
    return false;
  }
}

// ---------------------------------------------------------------- the ring

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: !process.env.RG_SMOKE_OPAQUE,
    backgroundColor: process.env.RG_SMOKE_OPAQUE ? '#3a3f48' : '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false, // WS_EX_NOACTIVATE: dictation stays in PowerScribe
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (pendingOpen) {
      const p = pendingOpen;
      pendingOpen = null;
      openRing(p.exe, p.mode, p.menuOverride);
    }
  });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// mode 'hold': opened by the trigger and released by it (flick).
// mode 'click': opened from the tray, Settings or a second launch.
function openRing(exe, mode = 'hold', menuOverride = null) {
  if (!overlay) return;
  if (!overlayReady) {
    pendingOpen = { exe, mode, menuOverride };
    return;
  }
  clearTimeout(hideTimer);
  const cursor = screen.getCursorScreenPoint();
  const b = screen.getDisplayNearestPoint(cursor).bounds;
  overlay.setBounds(b);
  ringOpen = true;
  const m = menuOverride || menu;
  overlay.webContents.send('rg:open', { x: cursor.x - b.x, y: cursor.y - b.y, menu: m, category: categoryForApp(m, exe), mode });
  overlay.showInactive();
  logEvent('ring-open', `${mode} ${exe || ''}`.trim());
  if (process.env.RG_SMOKE) smokeReport();
}

function smokeReport() {
  setTimeout(async () => {
    const st = await overlay.webContents.executeJavaScript(
      'JSON.stringify((s => s && { levels: s.levels.length, cat: s.cat, items: s.levels[0].items.length,' +
        ' drawn: document.querySelectorAll(".node:not(.back)").length,' +
        ' center: Math.round(document.querySelector(".center").getBoundingClientRect().width) })(window.RGRing.state()))'
    );
    console.log('SMOKE ring ' + st + ' visible=' + overlay.isVisible() + ' focusable=' + overlay.isFocusable());
    try {
      const img = await overlay.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.RG_SMOKE, 'overlay.png'), img.toPNG());
    } catch (e) {
      console.log('SMOKE capture failed: ' + e.message);
    }
    console.log('SMOKE captured');
  }, 900);
}

function hideRing(delay = 0) {
  ringOpen = false;
  for (const resolve of releaseWaiters.values()) resolve({ type: 'none' });
  releaseWaiters.clear();
  clearTimeout(hideTimer);
  const go = () => {
    if (ringOpen) return; // reopened meanwhile
    if (overlay) overlay.webContents.send('rg:close');
    if (overlay && overlay.isVisible()) overlay.hide();
  };
  if (delay) hideTimer = setTimeout(go, delay);
  else go();
}

// Runs a picked item. Returns the helper's reply for a release ("action:<id>"
// or "none"); a click queues helper actions for the helper's next poll.
function runItem(item, viaRelease) {
  const r = resolveAction(item.action, { env: process.env, clipboard: clipboard.readText() });
  logEvent('pick', `${item.name} -> ${item.action}`);
  switch (r.kind) {
    case 'helper':
      if (!supervisor.status().connected && !E2E) {
        notify(`"${item.name}" needs the helper, which is not running. Open Settings > Status.`);
      }
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
      notify(`"${item.name}" has no valid action. Fix it in Settings > Rings.`);
      return 'none';
  }
}

function hubCommand(id) {
  if (id === 'edit-menu' || id === 'settings') openSettings('rings');
  else if (id === 'open-folder') shell.openPath(userDir());
  else if (id === 'reload-menu') loadMenu();
  else notify(`Unknown command "${id}"`);
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
  hideRing(HIDE_AFTER_PICK_MS);
  runItem(item, false);
});
ipcMain.on('rg:dismiss', () => hideRing(HIDE_AFTER_PICK_MS));

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
    onShow: (exe) => {
      logEvent('show', exe);
      if (paused) return 'paused';
      openRing(exe, 'hold');
      return 'ok';
    },
    onRelease: async () => {
      logEvent('release');
      if (!ringOpen) return 'none';
      const result = await askRendererForRelease();
      if (result.type === 'stay') return 'stay';
      hideRing(HIDE_AFTER_PICK_MS);
      return result.type === 'select' ? runItem(result.item, true) : 'none';
    },
    onCancel: () => {
      logEvent('cancel');
      hideRing();
    },
    isOpen: () => ringOpen,
    onPoll: () => supervisor && supervisor.notePoll(),
    onDone: (action) => {
      logEvent('done', action);
      supervisor && supervisor.noteDone(action);
    },
  });
  const port = await bridge.listen(PREFERRED_PORT);
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(path.join(userDir(), 'bridge.ini'), `[Bridge]\r\nPort=${port}\r\nToken=${token}\r\n`);
  logEvent('bridge', `port ${port}`);
  return { port, token };
}

// ---------------------------------------------------------------- settings window

function openSettings(tab = 'rings') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('rgs:tab', tab);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'RadGesture Settings',
    backgroundColor: '#111318',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32' ? { color: '#111318', symbolColor: '#c9cfdb', height: 40 } : false,
    webPreferences: { preload: path.join(__dirname, '..', 'settings', 'preload.js'), contextIsolation: true, sandbox: false },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'settings', 'index.html'), { query: { tab } });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
  logEvent('settings-open', tab);
  return settingsWin;
}

function fullStatus() {
  return {
    version: app.getVersion(),
    helper: supervisor.status(),
    paused,
    conflicts: lastConflicts,
    startAtLogin: process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : false,
    dataFolder: userDir(),
    events: events.slice(-15),
  };
}

async function testApiKey(key, model) {
  if (!key) return { ok: false, error: 'Enter an API key first.' };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (r.ok) return { ok: true };
    const t = await r.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error.message;
    } catch (_) {}
    return { ok: false, error: `HTTP ${r.status}: ${msg}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: 'Could not reach Anthropic: ' + e.message };
  }
}

function tellHelperToReload() {
  bridge.enqueue('reload');
}

function registerSettingsIpc() {
  ipcMain.handle('rgs:get', () => ({
    menu: JSON.parse(JSON.stringify(menu)),
    defaultMenu: store.defaultMenu(),
    ai: store.readAI(),
    shortcuts: store.readShortcuts(),
    models: MODELS,
    iconNames: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'material-symbols-names.json'), 'utf8')),
    externalHotkeys: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'external_hotkeys.json'), 'utf8')),
    status: fullStatus(),
  }));
  ipcMain.handle('rgs:save-menu', (_e, m) => {
    const r = store.writeMenu(m);
    if (r.ok) {
      loadMenu();
      if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: menu.startAtLogin !== false });
      logEvent('menu-saved');
    }
    return r;
  });
  ipcMain.handle('rgs:save-ai', (_e, v) => {
    store.writeAI(v);
    tellHelperToReload();
    logEvent('ai-saved');
    return { ok: true };
  });
  ipcMain.handle('rgs:save-shortcuts', (_e, v) => {
    store.writeShortcuts(v);
    tellHelperToReload();
    logEvent('shortcuts-saved');
    return { ok: true };
  });
  ipcMain.handle('rgs:test-key', (_e, { key, model }) => testApiKey(key, model));
  ipcMain.handle('rgs:status', () => fullStatus());
  ipcMain.handle('rgs:restart-helper', () => {
    supervisor.restart();
    return fullStatus();
  });
  ipcMain.handle('rgs:rescan', async () => {
    await scanConflicts(false);
    return fullStatus();
  });
  ipcMain.handle('rgs:close-conflicts', async () => {
    await conflicts.closeAll(lastConflicts);
    await new Promise((r) => setTimeout(r, 800));
    await scanConflicts(false);
    supervisor.restart(); // take the keys back cleanly
    return fullStatus();
  });
  ipcMain.handle('rgs:open-uninstall', () => shell.openExternal('ms-settings:appsfeatures'));
  ipcMain.handle('rgs:open-data-folder', () => shell.openPath(userDir()));
  ipcMain.handle('rgs:pick-file', async (_e, kind) => {
    const r = await dialog.showOpenDialog(settingsWin, { properties: [kind === 'folder' ? 'openDirectory' : 'openFile'] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('rgs:try-ring', (_e, m) => {
    openRing('', 'click', m || null);
    return true;
  });
  ipcMain.handle('rgs:set-paused', (_e, p) => {
    setPaused(!!p);
    return fullStatus();
  });
  ipcMain.handle('rgs:run-helper-action', (_e, id) => {
    bridge.enqueue(id);
    return true;
  });
}

// ---------------------------------------------------------------- tray

function setPaused(p) {
  paused = p;
  if (paused) hideRing();
  updateTray();
}

function trayTemplate() {
  const h = supervisor.status();
  const helperLine = h.connected
    ? { label: 'Ring shortcut ready (Ctrl+CapsLock)', enabled: false }
    : { label: 'Helper not running - click to start it', click: () => supervisor.restart() };
  return [
    { label: 'Open the ring', click: () => openRing('', 'click') },
    { type: 'separator' },
    { label: 'Settings...', click: () => openSettings('general') },
    { label: 'Edit rings...', click: () => openSettings('rings') },
    { label: 'AI tools...', click: () => openSettings('ai') },
    { label: 'Shortcuts...', click: () => openSettings('shortcuts') },
    { type: 'separator' },
    helperLine,
    ...(lastConflicts.length ? [{ label: `Close ${lastConflicts.length} conflicting old tool(s)...`, click: () => openSettings('status') }] : []),
    { label: 'Pause the ring', type: 'checkbox', checked: paused, click: (mi) => setPaused(mi.checked) },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : false,
      click: (mi) => {
        if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: mi.checked });
        menu.startAtLogin = mi.checked;
        store.writeMenu(menu);
      },
    },
    { label: 'Status and help...', click: () => openSettings('status') },
    { type: 'separator' },
    { label: 'Quit RadGesture', click: () => app.quit() },
  ];
}

let trayKey = '';
function updateTray() {
  if (!tray) return;
  const h = supervisor.status();
  const key = `${h.connected}|${paused}|${lastConflicts.length}`;
  if (key === trayKey) return;
  trayKey = key;
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  tray.setToolTip(
    paused ? 'RadGesture - paused' : h.connected ? 'RadGesture - hold Ctrl+CapsLock' : 'RadGesture - helper not running (click for Settings)'
  );
}

function buildTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.on('click', () => openSettings('general'));
  tray.on('double-click', () => openSettings('general'));
  trayKey = '';
  updateTray();
}

// ---------------------------------------------------------------- conflicts

async function scanConflicts(announce) {
  const found = await conflicts.scan({ selfExe: process.execPath, selfPids: [process.pid] });
  lastConflicts = found;
  updateTray();
  if (announce && found.length) {
    notify(`${found.map((c) => c.label).join(', ')} ${found.length > 1 ? 'are' : 'is'} still running and will fight RadGesture for its keys. Open Settings > Status to close ${found.length > 1 ? 'them' : 'it'}.`);
  }
  return found;
}

// ---------------------------------------------------------------- start

if (process.platform === 'win32') app.setAppUserModelId('menu.radgesture.hub');

app.whenReady().then(async () => {
  loadMenu();
  createOverlay();
  supervisor = createSupervisor({
    resourcesDir: resourcesHelperDir(),
    ahkPathSetting: () => menu.helper && menu.helper.ahkPath,
    dataDir: userDir,
    onChange: () => updateTray(),
    log: (m) => logEvent('helper', m),
  });
  const bridgeInfo = await startBridge();
  registerSettingsIpc();
  buildTray();
  setInterval(updateTray, 2000); // helper connected/disconnected shows in the tray
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: menu.startAtLogin !== false });
  if ((!menu.helper || menu.helper.autoStart !== false) && !process.env.RG_NO_HELPER) supervisor.start();
  scanConflicts(true);

  // First run: show Settings so the API key and status are one glance away.
  if (!fs.existsSync(path.join(userDir(), 'welcomed')) && !E2E && !process.env.RG_SMOKE) {
    fs.writeFileSync(path.join(userDir(), 'welcomed'), new Date().toISOString());
    openSettings('status');
  }

  if (E2E) {
    // Hooks for the end-to-end tests (tests/e2e). Never set in normal use.
    global.__rg = {
      status: fullStatus,
      bridge: () => bridgeInfo,
      openSettings: (tab) => {
        openSettings(tab);
        return true;
      },
      openRing: (mode = 'click') => openRing('', mode),
      trayLabels: () => trayTemplate().map((i) => i.label || '---'),
      clickTray: (label) => {
        const it = trayTemplate().find((i) => i.label === label);
        if (!it || !it.click) return false;
        it.click({ checked: !it.checked });
        return true;
      },
      ringOpen: () => ringOpen,
      events: () => events.slice(),
      userDir,
    };
  }
});

app.on('second-instance', () => openSettings('general'));
app.on('window-all-closed', (e) => e.preventDefault()); // tray app: keep running
app.on('before-quit', () => supervisor && supervisor.stop());
