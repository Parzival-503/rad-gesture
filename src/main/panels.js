// The helper's small windows, drawn by the hub in the Settings look:
//
//   toolbar  the floating Prior checklist / chart text / Write toolbar
//   card     a result or a question: Impression, the prior checklist,
//            "empty the chart text?" (never takes focus, so Insert pastes
//            into the report that still has the cursor)
//   pick     the one-liner picker (takes the keyboard: 1-4, Esc)
//   toast    one short message, bottom right; clicks go through it
//
// The helper keeps the state (priors, chart pieces) and says what to show
// with POST /ui; buttons go back to it through the bridge queue. Every window
// is one page, src/panel/index.html?mode=<name>.

const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'panel', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'panel', 'preload.js');
const WIDTH = { toolbar: 292, card: 460, pick: 360, toast: 400 };
// What a panel may ask the helper to do.
const ACTION = /^(?:impression|oneliner|toolbar:hide|(?:prior|chart|imp|priorlist|pick):[a-z0-9:]{1,24})$/;

const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function clean(t, d) {
  d = d || {};
  if (t === 'toolbar') {
    const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, 30).map((x) => ({ peek: str(x && x.peek, 140), at: str(x && x.at, 8) }));
    return { visible: !!d.visible, priors: list(d.priors), chart: list(d.chart) };
  }
  if (t === 'card') {
    return {
      kind: str(d.kind, 20), icon: str(d.icon, 40), title: str(d.title, 200), sub: str(d.sub, 200),
      text: str(d.text, 8000), copy: str(d.copy, 8000), error: str(d.error, 2000), list: !!d.list, checks: !!d.checks,
      buttons: (Array.isArray(d.buttons) ? d.buttons : []).slice(0, 6).map((b) => ({
        id: str(b && b.id, 40), label: str(b && b.label, 40), icon: str(b && b.icon, 40), primary: !!(b && b.primary), keep: !!(b && b.keep),
      })).filter((b) => b.id && b.label),
    };
  }
  if (t === 'pick') {
    return {
      title: str(d.title, 120), sub: str(d.sub, 200), cancel: str(d.cancel, 40),
      options: (Array.isArray(d.options) ? d.options : []).slice(0, 9).map((o) => ({ id: str(o && o.id, 40), label: str(o && o.label, 60), hint: str(o && o.hint, 120), icon: str(o && o.icon, 40) })).filter((o) => o.id && o.label),
    };
  }
  if (t === 'toast') {
    const kinds = ['info', 'ok', 'warn', 'error'];
    return { text: str(d.text, 600), kind: kinds.includes(d.kind) ? d.kind : 'info', ms: Math.max(0, Math.min(60000, Number(d.ms) || 0)) };
  }
  return d;
}

function createPanels({ BrowserWindow, screen, ipcMain, clipboard, userDir, theme, enqueue, log = () => {} }) {
  const wins = {}; // mode -> BrowserWindow
  const data = {}; // mode -> what it shows
  let toastTimer = null;
  const prefsFile = () => path.join(userDir(), 'panels.json');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) || {}; } catch (_) { prefs = {}; }
  const savePrefs = () => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (_) {} };

  const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const alive = (m) => wins[m] && !wins[m].isDestroyed();
  const payload = (m) => Object.assign({ mode: m, theme: theme(), collapsed: !!(prefs.toolbar && prefs.toolbar.collapsed) }, data[m] || {});

  function make(m) {
    if (alive(m)) return wins[m];
    const a = area();
    const w = WIDTH[m];
    let x = a.x + a.width - w - 24, y = a.y + 96;
    if (m === 'toolbar' && prefs.toolbar && Number.isFinite(prefs.toolbar.x)) {
      // Back where it was left, if that spot is still on a screen.
      const p = { x: prefs.toolbar.x, y: prefs.toolbar.y };
      const on = screen.getAllDisplays().some((d) => p.x >= d.workArea.x - 40 && p.x < d.workArea.x + d.workArea.width - 60 && p.y >= d.workArea.y - 10 && p.y < d.workArea.y + d.workArea.height - 40);
      if (on) ({ x, y } = p);
    }
    if (m === 'card') {
      const tb = alive('toolbar') && wins.toolbar.isVisible() ? wins.toolbar.getBounds() : null;
      if (tb) { x = Math.max(a.x + 8, tb.x - w - 12); y = tb.y; } else { y = a.y + 150; }
    }
    if (m === 'pick') {
      const c = screen.getCursorScreenPoint();
      x = Math.min(Math.max(a.x + 8, c.x - 40), a.x + a.width - w - 8);
      y = Math.min(Math.max(a.y + 8, c.y - 20), a.y + a.height - 320);
    }
    if (m === 'toast') { x = a.x + a.width - w - 16; y = a.y + a.height - 120; }
    const win = new BrowserWindow({
      width: w, height: 120, x: Math.round(x), y: Math.round(y),
      show: false, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      focusable: m === 'pick', // the rest never take the keyboard from the report
      title: m === 'pick' ? 'RadGesture One-liner' : 'RadGesture',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
    });
    if (m === 'toast') win.setIgnoreMouseEvents(true);
    win.on('closed', () => { if (wins[m] === win) delete wins[m]; });
    win.loadFile(PAGE, { query: { mode: m } });
    wins[m] = win;
    return win;
  }

  function show(m) {
    const win = make(m);
    const send = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('rgpn:data', payload(m));
      if (m === 'pick') {
        win.setAlwaysOnTop(true);
        win.show();
        win.moveTop();
        win.focus();
      } else {
        win.showInactive();
        win.moveTop();
      }
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
  const hide = (m) => { if (alive(m)) wins[m].hide(); };

  // POST /ui from the helper.
  function handle(d) {
    const t = d && d.t;
    if (t === 'toolbar') {
      data.toolbar = clean('toolbar', d);
      if (data.toolbar.visible) show('toolbar');
      else hide('toolbar');
    } else if (t === 'card' || t === 'pick') {
      data[t] = clean(t, d);
      show(t);
      log(t, data[t].title);
    } else if (t === 'card-close' || t === 'pick-close') {
      hide(t.slice(0, -6));
    } else if (t === 'toast') {
      data.toast = clean('toast', d);
      clearTimeout(toastTimer);
      if (!data.toast.text) hide('toast');
      else {
        show('toast');
        if (data.toast.ms) toastTimer = setTimeout(() => hide('toast'), data.toast.ms);
      }
    } else if (t === 'toast-hide') {
      clearTimeout(toastTimer);
      hide('toast');
    } else {
      return 'unknown';
    }
    return 'ok';
  }

  function modeOf(e) {
    return Object.keys(wins).find((m) => alive(m) && wins[m].webContents === e.sender);
  }
  let drag = null;
  ipcMain.handle('rgpn:get', (e) => { const m = modeOf(e); return m ? payload(m) : null; });
  ipcMain.handle('rgpn:act', (e, id) => {
    id = String(id || '');
    if (!ACTION.test(id)) return false;
    const m = modeOf(e);
    if (id === 'toolbar:hide') hide('toolbar');
    enqueue(id);
    log('panel', `${m}: ${id}`);
    return true;
  });
  ipcMain.handle('rgpn:copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('rgpn:close', (e) => { const m = modeOf(e); if (m) hide(m); return true; });
  ipcMain.handle('rgpn:size', (e, h) => {
    const m = modeOf(e);
    if (!m) return;
    const win = wins[m];
    const b = win.getBounds();
    const height = Math.max(40, Math.min(900, Math.ceil(Number(h) || 0)));
    if (m === 'toast') {
      const a = screen.getDisplayMatching(b).workArea;
      win.setBounds({ x: b.x, y: a.y + a.height - height - 12, width: b.width, height });
    } else if (b.height !== height) win.setBounds({ x: b.x, y: b.y, width: b.width, height });
  });
  ipcMain.handle('rgpn:drag', (e, phase, dx, dy) => {
    const m = modeOf(e);
    if (!m || m === 'toast') return;
    const win = wins[m];
    if (phase === 'start') drag = { m, b: win.getBounds() };
    else if (drag && drag.m === m) {
      win.setBounds({ x: Math.round(drag.b.x + dx), y: Math.round(drag.b.y + dy), width: drag.b.width, height: drag.b.height });
      if (phase === 'end') {
        if (m === 'toolbar') { prefs.toolbar = Object.assign({}, prefs.toolbar, { x: drag.b.x + Math.round(dx), y: drag.b.y + Math.round(dy) }); savePrefs(); }
        drag = null;
      }
    }
  });
  ipcMain.handle('rgpn:collapse', (_e, on) => {
    prefs.toolbar = Object.assign({}, prefs.toolbar, { collapsed: !!on });
    savePrefs();
    return true;
  });

  return {
    handle,
    hideAll: () => Object.keys(wins).forEach(hide),
    // Quitting: close them outright, so none can hold the app open.
    destroyAll: () => Object.keys(wins).forEach((m) => { if (alive(m)) wins[m].destroy(); }),
    retheme: () => Object.keys(wins).forEach((m) => { if (alive(m) && wins[m].isVisible()) wins[m].webContents.send('rgpn:data', payload(m)); }),
    // e2e
    windows: () => Object.fromEntries(Object.keys(wins).filter(alive).map((m) => [m, wins[m].isVisible()])),
  };
}

module.exports = { createPanels, clean, ACTION };
