// Everything the Settings window shows and saves, in one place.
//
//  - the rings:        %APPDATA%\RadGesture\menu.json (created from the default)
//  - AI + shortcuts:   %APPDATA%\RadGesture\RadGesture.ini, the file the helper
//                      reads; after a save the hub tells the helper to reload
//  - the library:      config/library.json (the functions and their defaults)
//                      -> RadGesture.ini [Lib.<id>] (what the person chose)
//
// Sina never edits either file by hand; the Settings window does.

const fs = require('fs');
const path = require('path');
const ini = require('./ini');
const { validateMenu } = require('../common/menu');
const { cleanKey } = require('../common/apikey');

// Offered in Settings > AI tools. A saved model not in this list (a retired
// one) reads back as Sonnet 5.5; the helper does the same (NormalizeModel).
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const MODEL_LABELS = {
  'claude-sonnet-5-5': 'Sonnet 5.5 (recommended)',
  'claude-haiku-5-5': 'Haiku 5.5 (fastest, cheapest)',
  'claude-opus-5-5': 'Opus 5.5 (most careful, slower)',
};

// INI field <-> settings field, with the helper's own defaults.
const AI_FIELDS = {
  apiKey: ['API', 'ApiKey', ''],
  model: ['API', 'Model', 'claude-sonnet-5-5'],
  sensitivity: ['Behavior', 'Sensitivity', 'moderate'],
  impressionRules: ['Impression', 'ExtraRules', 'Keep it very short. No measurements or other numbers.'],
  impressionModel: ['Impression', 'Model', ''],
  priorExpireMinutes: ['Priors', 'ExpireMinutes', '30'],
  priorCapture: ['Priors', 'CaptureMode', 'clipboard'],
  toolbarAtStartup: ['Priors', 'ShowAtStartup', '1'],
};
const SHORTCUT_FIELDS = {
  trigger: ['Hub', 'Trigger', '^CapsLock'],
  proofread: ['Behavior', 'Hotkey', '^!q'],
  oneliner: ['OneLiner', 'Hotkey', '^!u'],
  lungrads: ['LungRADS', 'Hotkey', '!+l'],
  impression: ['Impression', 'Hotkey', ''],
  priorAdd: ['Priors', 'AddHotkey', ''],
  priorChecklist: ['Priors', 'ChecklistHotkey', ''],
};

// The function library (Rad Optimizer's functions, built into the helper).
// Defaults come from config/library.json; what a person changes lives in
// RadGesture.ini [Lib.<id>]: On (keyboard shortcut on), Hotkey, and each
// param (Key = what it presses in Sectra/PowerScribe, Tab, Enter, Urls).
// Target says which program a "bring it up and press Key" function uses; it
// is not a setting, so it is always rewritten from the JSON. The username is
// [Library] Username. The password is never stored (the helper asks for it).
const LIB_SECTION = (id) => 'Lib.' + id;
function libraryDefaults(lib) {
  const out = {};
  for (const f of lib.functions) {
    const v = { On: f.on ? '1' : '0', Hotkey: f.hotkey || '' };
    for (const p of f.params || []) v[p.name] = p.default;
    out[f.id] = v;
  }
  return out;
}
// Fills in what is missing, so the helper always finds every value. Returns
// whether the file changed.
function syncLibraryIni(s, lib) {
  let changed = false;
  const defs = libraryDefaults(lib);
  for (const f of lib.functions) {
    const sec = LIB_SECTION(f.id);
    for (const [k, v] of Object.entries(defs[f.id])) {
      if (ini.get(s, sec, k, null) === null) {
        ini.set(s, sec, k, v);
        changed = true;
      }
    }
    if (f.target && ini.get(s, sec, 'Target', null) !== f.target) {
      ini.set(s, sec, 'Target', f.target);
      changed = true;
    }
  }
  return changed;
}

// The ring's Rad Optimizer keys ("helper:keys:^!2") -> the library function
// that key used to start in Rad Optimizer ("helper:lib:PACS_WL_Lung"). Only a
// key that is exactly Rad Optimizer's default changes; a key a person chose
// for their own Sectra stays a key press.
function optimizerKeyMap(lib) {
  const m = new Map();
  for (const f of lib.functions) if (f.hotkey) m.set('helper:keys:' + f.hotkey, 'helper:lib:' + f.id);
  return m;
}

// One-time changes to a menu saved by an older version. Each runs once
// (recorded in `migrated`), so something the person adds back stays.
const OLD_STOPWATCH_KEYS = ['helper:keys:{F4}', 'helper:keys:{F12}'];
function migrate(m, lib) {
  const done = Array.isArray(m.migrated) ? m.migrated : [];
  let changed = false;
  if (!done.includes('no-stopwatch-ring')) {
    // v3.0 shipped a Stopwatch ring; RadStopwatch is no longer part of
    // RadGesture. Remove it only while it is still the shipped one (just the
    // F4 / F12 keys), never a ring the person built up themselves.
    const i = m.categories.findIndex((c) => c.id === 'stopwatch' &&
      (c.items || []).every((it) => OLD_STOPWATCH_KEYS.includes(it.action)));
    if (i >= 0 && m.categories.length > 1) m.categories.splice(i, 1);
    done.push('no-stopwatch-ring');
    changed = true;
  }
  if (!done.includes('orthogonal-in-measure')) {
    // Orthogonal is a measuring tool (Sina): it moves from Crosshair to
    // Measure, right after Distance. Only when both are where we shipped them.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const sub = (n) => pacs && (pacs.items || []).find((it) => it.name === n && Array.isArray(it.items));
    const meas = sub('Measure');
    const cross = sub('Crosshair');
    const oi = cross ? cross.items.findIndex((it) => it.action === 'helper:keys:^!o' || it.action === 'helper:lib:PACS_Orthogonal') : -1;
    const di = meas ? meas.items.findIndex((it) => it.name === 'Distance') : -1;
    if (oi >= 0 && di >= 0 && meas.items.length < 8 && cross.items.length > 1) {
      const [o] = cross.items.splice(oi, 1);
      if (o.icon === 'view_in_ar') o.icon = 'square_foot';
      meas.items.splice(di + 1, 0, o);
    }
    done.push('orthogonal-in-measure');
    changed = true;
  }
  if (!done.includes('no-paste-indication')) {
    // Rad Optimizer's Paste indication (Ctrl+Alt+G) works only on a selection
    // made by hand, never from the ring (Sina), so the ring no longer has it.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const ps = pacs && (pacs.items || []).find((it) => it.name === 'PowerScribe' && Array.isArray(it.items));
    if (ps && ps.items.length > 1) ps.items = ps.items.filter((it) => !(it.action === 'helper:keys:^!g' && it.name === 'Paste indication'));
    done.push('no-paste-indication');
    changed = true;
  }
  if (lib && !done.includes('library')) {
    // Rad Optimizer's functions are built in now: the PACS and Apps rings run
    // them directly instead of pressing Rad Optimizer's keys, so they work
    // without Rad Optimizer running.
    const map = optimizerKeyMap(lib);
    const walk = (items) => (items || []).forEach((it) => {
      if (it.items) walk(it.items);
      else if (map.has(it.action)) it.action = map.get(it.action);
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('library');
    changed = true;
  }
  if (changed) m.migrated = done;
  return changed;
}

function createStore({ userDir, defaultMenuPath, libraryPath }) {
  const menuPath = () => path.join(userDir(), 'menu.json');
  const iniPath = () => path.join(userDir(), 'RadGesture.ini');
  const defaultMenu = () => JSON.parse(fs.readFileSync(defaultMenuPath, 'utf8'));
  const library = () => (libraryPath ? JSON.parse(fs.readFileSync(libraryPath, 'utf8')) : null);

  function readMenu() {
    if (!fs.existsSync(menuPath())) {
      fs.mkdirSync(userDir(), { recursive: true });
      fs.writeFileSync(menuPath(), JSON.stringify(defaultMenu(), null, 2));
    }
    const m = JSON.parse(fs.readFileSync(menuPath(), 'utf8'));
    const v = validateMenu(m);
    if (!v.ok) throw new Error(v.errors.slice(0, 3).join('; '));
    if (migrate(m, library())) writeMenu(m);
    return m;
  }

  function writeMenu(m) {
    const v = validateMenu(m);
    if (!v.ok) return { ok: false, errors: v.errors };
    fs.mkdirSync(userDir(), { recursive: true });
    const tmp = menuPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
    fs.renameSync(tmp, menuPath());
    return { ok: true, errors: [] };
  }

  // Every library value the helper reads, written before the helper starts.
  function syncLibrary() {
    const lib = library();
    if (!lib) return false;
    const s = readIni();
    if (!syncLibraryIni(s, lib)) return false;
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
    return true;
  }

  // { values: { <id>: { On, Hotkey, Key, ... } }, username }
  function readLibrary() {
    const lib = library();
    const s = readIni();
    const defs = libraryDefaults(lib);
    const values = {};
    for (const f of lib.functions) {
      values[f.id] = {};
      for (const [k, v] of Object.entries(defs[f.id])) values[f.id][k] = ini.get(s, LIB_SECTION(f.id), k, v);
    }
    return { values, username: ini.get(s, 'Library', 'Username', '') };
  }

  function writeLibrary(v) {
    const lib = library();
    const s = readIni();
    const defs = libraryDefaults(lib);
    for (const f of lib.functions) {
      const mine = (v.values || {})[f.id] || {};
      for (const k of Object.keys(defs[f.id])) if (mine[k] !== undefined) ini.set(s, LIB_SECTION(f.id), k, String(mine[k]));
    }
    if (v.username !== undefined) ini.set(s, 'Library', 'Username', String(v.username).trim());
    syncLibraryIni(s, lib);
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
  }

  // One-time changes to an older RadGesture.ini (recorded in [RadGesture]
  // Migrated). Runs before the helper starts, so it reads the result.
  function migrateIni() {
    if (!fs.existsSync(iniPath())) return false;
    const s = readIni();
    const done = String(ini.get(s, 'RadGesture', 'Migrated', '')).split(',').filter(Boolean);
    if (done.includes('prior-toolbar')) return false;
    // The first v3 builds hid RadProofread's floating Priors toolbar by default
    // and saving AI settings wrote that down; Sina relies on it. Show it again.
    ini.set(s, 'Priors', 'ShowAtStartup', '1');
    done.push('prior-toolbar');
    ini.set(s, 'RadGesture', 'Migrated', done.join(','));
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
    return true;
  }

  function readIni() {
    return ini.parse(fs.existsSync(iniPath()) ? fs.readFileSync(iniPath(), 'latin1') : '');
  }

  function readFields(fields) {
    const s = readIni();
    const out = {};
    for (const [k, [sec, key, dflt]] of Object.entries(fields)) out[k] = ini.get(s, sec, key, dflt);
    return out;
  }

  function writeFields(fields, values) {
    const s = readIni();
    for (const [k, [sec, key]] of Object.entries(fields)) {
      if (values[k] !== undefined) ini.set(s, sec, key, values[k]);
    }
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
  }

  return {
    menuPath,
    iniPath,
    defaultMenu,
    library,
    readMenu,
    syncLibrary,
    readLibrary,
    writeLibrary,
    migrateIni,
    writeMenu,
    readAI: () => {
      const v = readFields(AI_FIELDS);
      if (!MODELS.includes(v.model)) v.model = MODELS[0];
      v.apiKey = cleanKey(v.apiKey);
      return v;
    },
    writeAI: (v) => writeFields(AI_FIELDS, { ...v, ...(v.apiKey !== undefined ? { apiKey: cleanKey(v.apiKey) } : {}) }),
    readShortcuts: () => readFields(SHORTCUT_FIELDS),
    writeShortcuts: (v) => writeFields(SHORTCUT_FIELDS, v),
  };
}

module.exports = { createStore, MODELS, MODEL_LABELS, AI_FIELDS, SHORTCUT_FIELDS, migrate, libraryDefaults, syncLibraryIni, optimizerKeyMap };
