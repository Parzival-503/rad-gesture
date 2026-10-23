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
const { resolveAction, runSpec } = require('./actions');
const { createStore, MODELS, MODEL_LABELS } = require('./settings-store');
const { createSupervisor } = require('./helper-supervisor');
const conflicts = require('./conflicts');
const { categoryForApp, parseAction } = require('../common/menu');
const apikey = require('../common/apikey');
const { createIconStore } = require('./icon-store');

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
const store = createStore({ userDir, defaultMenuPath: path.join(ROOT, 'config', 'default-menu.json'), libraryPath: path.join(ROOT, 'config', 'library.json') });
const icons = createIconStore({ dir: () => path.join(userDir(), 'icons'), nativeImage });
const { codeFor } = require('./library-code');
const { createReferences } = require('./references');
const refs = createReferences({ dir: () => path.join(userDir(), 'references') });
const resourcesHelperDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'helper') : path.join(ROOT, 'helper'));

let overlay = null;
let overlayReady = false;
let pendingOpen = null;
let settingsWin = null;
let viewerWin = null;
let tray = null;
let bridge = null;
let supervisor = null;
let menu = null;
let ringOpen = false;
let paused = false;
let hideTimer = null;
let releaseSeq = 0;
let lastConflicts = [];
let libHotkeys = null; // { count, failed, at } from the helper, after each start / reload
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
  overlay.webContents.send('rg:open', { x: cursor.x - b.x, y: cursor.y - b.y, menu: m, category: categoryForApp(m, exe), mode, images: icons.dataUrls(icons.usedBy(m)) });
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
// The clipboard, the way Electron 44 gives it: asynchronously (readText
// returns a promise; reading it like the old API gave "[object Promise]",
// which is what "Search copied text" searched for until this was fixed).
async function clipText() {
  try {
    return String((await clipboard.readText()) || '');
  } catch (_) {
    return '';
  }
}
async function clipImage() {
  try {
    for (const it of await clipboard.read()) {
      const type = (it.types || []).find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await it.getType(type);
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (!img.isEmpty()) return img;
    }
  } catch (_) {}
  return null;
}

function runItem(item, viaRelease) {
  const parsed = parseAction(item.action);
  if (parsed && parsed.kind === 'search') {
    // Needs the copied text first (asynchronous).
    logEvent('pick', `${item.name} -> ${item.action}`);
    clipText().then((text) => {
      const r = resolveAction(item.action, { env: process.env, clipboard: text });
      logEvent('search', r.value);
      shell.openExternal(r.value);
    });
    return 'none';
  }
  const r = resolveAction(item.action, { env: process.env, clipboard: '' });
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
    case 'ref':
      openReference(r.value);
      return 'none';
    case 'app': {
      // The helper starts it or brings it to the front; without the helper,
      // start it directly (no "already open" check).
      const spec = runSpec(item, null, process.env);
      if (supervisor.status().connected || E2E) {
        if (viaRelease) return 'action:' + spec;
        bridge.enqueue(spec);
      } else openProgramDirect(r.value, item.args);
      return 'none';
    }
    default:
      notify(`"${item.name}" has no valid action. Fix it in Settings > Rings.`);
      return 'none';
  }
}

function openProgramDirect(file, args) {
  if (!args || process.platform !== 'win32') {
    shell.openPath(file).then((err) => err && notify(`Could not open ${file}: ${err}`));
    return;
  }
  try {
    require('child_process').spawn('cmd.exe', ['/c', 'start', '""', file, ...String(args).split(' ').filter(Boolean)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    notify(`Could not open ${file}: ${e.message}`);
  }
}

// Programs marked "Start it with RadGesture" (RadStopwatch, a shortcut
// script...): once the helper checks in, it starts each one that is not
// already running. Without the helper after 15 s, they are started directly.
function startWithHubItems() {
  const out = [];
  const walk = (items) => (items || []).forEach((it) => {
    if (it.items) walk(it.items);
    else if (it.startWithHub && typeof it.action === 'string' && it.action.startsWith('app:')) out.push(it);
  });
  (menu.categories || []).forEach((c) => walk(c.items));
  return out;
}
function startPrograms() {
  const list = startWithHubItems();
  if (!list.length || E2E) return;
  const started = Date.now();
  const tick = setInterval(() => {
    const ok = supervisor.status().connected;
    if (!ok && Date.now() - started < 15000) return;
    clearInterval(tick);
    for (const it of list) {
      logEvent('autostart', it.name);
      if (ok) bridge.enqueue(runSpec(it, 'start', process.env));
      else openProgramDirect(resolveAction(it.action, { env: process.env }).value, it.args);
    }
  }, 500);
}

function hubCommand(id) {
  if (id === 'edit-menu' || id === 'settings') openSettings('rings');
  else if (id === 'open-folder') shell.openPath(userDir());
  else if (id === 'reload-menu') loadMenu();
  else if (id === 'ref-add') addReferenceFromClipboard(true);
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
      // The helper says how many function shortcuts it switched on.
      const m = /^lib-hotkeys:(\d+):?(.*)$/.exec(action);
      if (m) libHotkeys = { count: Number(m[1]), failed: m[2] ? m[2].split(', ') : [], at: Date.now() };
      supervisor && supervisor.noteDone(action);
    },
    onOpenSettings: (tab) => openSettings(tab || 'general'),
    onQuit: () => {
      logEvent('quit', 'asked by Setup');
      setTimeout(() => app.quit(), 50); // before-quit stops the helper
    },
  });
  const port = await bridge.listen(PREFERRED_PORT);
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(path.join(userDir(), 'bridge.ini'), `[Bridge]\r\nPort=${port}\r\nToken=${token}\r\n`);
  logEvent('bridge', `port ${port}`);
  return { port, token };
}

// ---------------------------------------------------------------- settings window

// ---------------------------------------------------------------- Reference library

// A reference for a page: its note, and its picture as a data: URL (full
// size, or a small one for lists).
function refForPage(r, thumb) {
  if (!r) return null;
  let image = '';
  if (r.image) {
    const img = nativeImage.createFromPath(path.join(userDir(), 'references', r.image));
    if (!img.isEmpty()) image = (thumb ? img.resize({ width: Math.min(320, img.getSize().width) }) : img).toDataURL();
  }
  return { ...r, image };
}

// Screenshots are kept at most 2400 px wide (a 4K snip stays readable, the
// folder stays small), as PNG.
function pngOf(img) {
  if (!img || img.isEmpty()) return null;
  const { width } = img.getSize();
  return (width > 2400 ? img.resize({ width: 2400, quality: 'best' }) : img).toPNG();
}

// The clipboard (a screenshot, or text) as a new reference. From the ring
// ("Add from clipboard"), the tray, or Settings.
async function addReferenceFromClipboard(openIt) {
  const img = await clipImage();
  let r = null;
  if (img) r = refs.save({ png: pngOf(img), body: '' });
  else {
    const text = (await clipText()).trim();
    if (text) {
      const { titleOf } = require('../common/markdown');
      r = refs.save({ title: titleOf(text), body: text });
    }
  }
  if (!r) {
    notify('Nothing to add: copy text, or take a screenshot (Win+Shift+S), then try again.');
    return null;
  }
  logEvent('ref-added', r.id);
  if (openIt) openSettings('references:' + r.id);
  return r;
}

function openReference(id) {
  const r = refs.get(id);
  if (!r) return notify('That reference is gone. Fix the ring direction in Settings > Rings.');
  const pt = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(pt).workArea;
  if (!viewerWin || viewerWin.isDestroyed()) {
    const w = Math.min(820, area.width - 40), h = Math.min(900, area.height - 40);
    viewerWin = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(area.x + (area.width - w) / 2),
      y: Math.round(area.y + (area.height - h) / 2),
      show: false,
      title: 'Reference',
      backgroundColor: '#111318',
      icon: path.join(ROOT, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, '..', 'viewer', 'preload.js'), contextIsolation: true, sandbox: false },
    });
    viewerWin.on('closed', () => (viewerWin = null));
    viewerWin.once('ready-to-show', () => viewerWin.show());
    viewerWin.loadFile(path.join(__dirname, '..', 'viewer', 'index.html'), { query: { id } });
  } else {
    viewerWin.webContents.send('rgv:show', id);
    viewerWin.show();
    viewerWin.focus();
  }
  logEvent('ref-open', id);
}

function registerViewerIpc() {
  ipcMain.handle('rgv:get', (_e, id) => ({ ref: refForPage(refs.get(id), false), theme: menu && menu.theme }));
  ipcMain.handle('rgv:open-link', (_e, url) => { if (/^(https?:\/\/|mailto:)/i.test(String(url))) shell.openExternal(url); });
  ipcMain.handle('rgv:edit', (_e, id) => { openSettings('references:' + id); });
  ipcMain.handle('rgv:close', () => { if (viewerWin && !viewerWin.isDestroyed()) viewerWin.close(); });
}

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

// Running as administrator: an ordinary installer cannot close (update) it,
// so Settings > Status says so. "net session" succeeds only when elevated.
let elevated = false;
if (process.platform === 'win32') {
  require('child_process').execFile('net', ['session'], { windowsHide: true }, (err) => {
    elevated = !err;
  });
}

function fullStatus() {
  return {
    version: app.getVersion(),
    elevated,
    helper: supervisor.status(),
    paused,
    conflicts: lastConflicts,
    libHotkeys,
    libHotkeysWanted: libraryWanted(),
    startAtLogin: process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : false,
    dataFolder: userDir(),
    events: events.slice(-15),
  };
}

async function testApiKey(key, model) {
  key = apikey.cleanKey(key);
  const why = apikey.keyProblem(key);
  if (why) return { ok: false, error: why };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // 5.5 models think first and reject temperature: room for that, low effort.
      body: JSON.stringify({ model: model || MODELS[0], max_tokens: 64, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (r.ok) return { ok: true };
    const t = await r.text();
    let msg = t;
    try {
      msg = JSON.parse(t).error.message;
    } catch (_) {}
    return { ok: false, error: apikey.errorText(r.status, msg) };
  } catch (e) {
    return { ok: false, error: 'Could not reach Anthropic: ' + e.message };
  }
}

function libraryCode() {
  try {
    const src = fs.readFileSync(path.join(resourcesHelperDir(), 'RadGestureHelper.ahk'), 'utf8');
    return codeFor(store.library(), src, store.readLibrary().values);
  } catch (_) {
    return {};
  }
}

// Is any library keyboard shortcut switched on? Then a running Rad Optimizer
// takes the same keys and is listed as a clash.
function libraryHotkeysOn() {
  try {
    return Object.values(store.readLibrary().values).some((v) => v.On === '1' && v.Hotkey);
  } catch (_) {
    return false;
  }
}

// How many function shortcuts are switched on in Settings (what the helper
// should report back).
function libraryWanted() {
  try {
    const v = store.readLibrary().values;
    return new Set(Object.values(v).filter((x) => x.On === '1' && x.Hotkey).map((x) => x.Hotkey.toLowerCase())).size;
  } catch (_) {
    return 0;
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
    modelLabels: MODEL_LABELS,
    images: icons.dataUrls(),
    iconNames: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'material-symbols-names.json'), 'utf8')),
    externalHotkeys: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'external_hotkeys.json'), 'utf8')),
    library: store.library(),
    libraryValues: store.readLibrary(),
    libraryCode: libraryCode(),
    status: fullStatus(),
  }));
  ipcMain.handle('rgs:refs', () => refs.list().map((r) => refForPage(r, true)));
  ipcMain.handle('rgs:ref-get', (_e, id) => refForPage(refs.get(id), false));
  ipcMain.handle('rgs:ref-save', (_e, v) => refForPage(refs.save({ id: v.id, title: v.title, tags: v.tags, body: v.body }), true));
  ipcMain.handle('rgs:ref-delete', (_e, id) => refs.remove(id));
  ipcMain.handle('rgs:ref-open', (_e, id) => openReference(id));
  // A picture for a reference (new, or added to one): from the clipboard or a file.
  ipcMain.handle('rgs:ref-paste', async (_e, id) => {
    const img = await clipImage();
    if (!img) {
      if (id) return { ok: false, error: 'No picture on the clipboard. Take a screenshot first (Win+Shift+S).' };
      const r = await addReferenceFromClipboard(false);
      return r ? { ok: true, ref: refForPage(r, true) } : { ok: false, error: 'The clipboard is empty: copy text or take a screenshot first.' };
    }
    return { ok: true, ref: refForPage(refs.save({ id, png: pngOf(img) }), true) };
  });
  ipcMain.handle('rgs:ref-pick-image', async (_e, id) => {
    const r = await dialog.showOpenDialog(settingsWin, { title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const png = pngOf(nativeImage.createFromPath(r.filePaths[0]));
    if (!png) return { ok: false, error: 'That file is not a picture RadGesture can read.' };
    return { ok: true, ref: refForPage(refs.save({ id, png, title: id ? undefined : path.basename(r.filePaths[0]).replace(/\.[^.]+$/, '') }), true) };
  });
  // Windows' own snipping overlay; the snip lands on the clipboard and is
  // added as soon as it appears (up to a minute).
  ipcMain.handle('rgs:ref-snip', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Snipping needs Windows. Copy a picture, then Paste screenshot.' };
    const first = await clipImage();
    const before = first ? first.toDataURL() : '';
    clipboard.clear();
    shell.openExternal('ms-screenclip:');
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      await new Promise((res) => setTimeout(res, 400));
      const img = await clipImage();
      if (img && img.toDataURL() !== before) {
        const r = refs.save({ png: pngOf(img), body: '' });
        logEvent('ref-added', r.id + ' (snip)');
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.focus();
        return { ok: true, ref: refForPage(r, true) };
      }
    }
    return { ok: false, error: 'No snip in the last minute.' };
  });
  ipcMain.handle('rgs:save-library', (_e, v) => {
    store.writeLibrary(v);
    tellHelperToReload();
    logEvent('library-saved');
    scanConflicts(false);
    return { ok: true };
  });
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
  // Shortcut sets: a small file a colleague can import (Settings > Shortcuts).
  ipcMain.handle('rgs:export-keys', async (_e, set) => {
    const r = await dialog.showSaveDialog(settingsWin, {
      title: 'Save your RadGesture shortcuts',
      defaultPath: path.join(app.getPath('documents'), 'RadGesture shortcuts.rgkeys'),
      filters: [{ name: 'RadGesture shortcuts', extensions: ['rgkeys'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(set, null, 2));
    logEvent('keys-exported', path.basename(r.filePath));
    return { ok: true, file: r.filePath };
  });
  ipcMain.handle('rgs:import-keys', async () => {
    const r = await dialog.showOpenDialog(settingsWin, {
      title: 'Import RadGesture shortcuts',
      filters: [{ name: 'RadGesture shortcuts', extensions: ['rgkeys', 'json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      return { ok: true, set: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')), file: path.basename(r.filePaths[0]) };
    } catch (e) {
      return { ok: false, error: 'Could not read that file: ' + e.message };
    }
  });
  // Ring icons: a picture of the user's, or a program's own icon.
  ipcMain.handle('rgs:import-icon', async () => {
    const r = await dialog.showOpenDialog(settingsWin, {
      title: 'Choose a picture for the icon',
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'svg', 'ico', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const res = icons.importFile(r.filePaths[0]);
    return res.ok ? { ok: true, icon: 'img:' + res.file, images: icons.dataUrls() } : res;
  });
  ipcMain.handle('rgs:pick-program', async () => {
    const r = await dialog.showOpenDialog(settingsWin, {
      title: 'Choose a program, shortcut or script',
      filters: [{ name: 'Programs and scripts', extensions: ['exe', 'lnk', 'ahk', 'bat', 'cmd', 'url'] }, { name: 'Any file', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const file = r.filePaths[0];
    let icon = null;
    try {
      const f = icons.saveProgramIcon(file, await app.getFileIcon(file, { size: 'large' }));
      if (f) icon = 'img:' + f;
    } catch (_) {}
    return { ok: true, path: file, name: path.basename(file).replace(/\.[^.]+$/, ''), icon, images: icons.dataUrls() };
  });
  ipcMain.handle('rgs:program-icon', async (_e, file) => {
    try {
      const f = icons.saveProgramIcon(file, await app.getFileIcon(resolveAction('app:' + file, { env: process.env }).value, { size: 'large' }));
      return f ? { icon: 'img:' + f, images: icons.dataUrls() } : null;
    } catch (_) {
      return null;
    }
  });
  ipcMain.handle('rgs:copy-text', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
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
    { label: 'Functions...', click: () => openSettings('functions') },
    { label: 'Reference library...', click: () => openSettings('references') },
    { label: 'Add clipboard to the Reference library', click: () => addReferenceFromClipboard(true) },
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
  const found = await conflicts.scan({ selfExe: process.execPath, selfPids: [process.pid], libraryOn: libraryHotkeysOn() });
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
  registerViewerIpc();
  buildTray();
  setInterval(updateTray, 2000); // helper connected/disconnected shows in the tray
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: menu.startAtLogin !== false });
  try { store.migrateIni(); } catch (e) { logEvent('error', 'ini migration: ' + e.message); }
  try { store.syncLibrary(); } catch (e) { logEvent('error', 'library settings: ' + e.message); }
  if ((!menu.helper || menu.helper.autoStart !== false) && !process.env.RG_NO_HELPER) supervisor.start();
  startPrograms();
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
      hideRing: () => hideRing(),
      trayLabels: () => trayTemplate().map((i) => i.label || '---'),
      clickTray: (label) => {
        const it = trayTemplate().find((i) => i.label === label);
        if (!it || !it.click) return false;
        it.click({ checked: !it.checked });
        return true;
      },
      ringOpen: () => ringOpen,
      runAction: (action) => runItem({ name: 'e2e', action }, false),
      events: () => events.slice(),
      userDir,
    };
  }
});

app.on('second-instance', () => openSettings('general'));
app.on('window-all-closed', (e) => e.preventDefault()); // tray app: keep running
app.on('before-quit', () => supervisor && supervisor.stop());
