// Everything the Settings window shows and saves, in one place.
//
//  - the rings:        %APPDATA%\RadGesture\menu.json (created from the default)
//  - AI + shortcuts:   %APPDATA%\RadGesture\RadGesture.ini, the file the helper
//                      reads; after a save the hub tells the helper to reload
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

// One-time changes to a menu saved by an older version. Each runs once
// (recorded in `migrated`), so something the person adds back stays.
const OLD_STOPWATCH_KEYS = ['helper:keys:{F4}', 'helper:keys:{F12}'];
function migrate(m) {
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
  if (changed) m.migrated = done;
  return changed;
}

function createStore({ userDir, defaultMenuPath }) {
  const menuPath = () => path.join(userDir(), 'menu.json');
  const iniPath = () => path.join(userDir(), 'RadGesture.ini');
  const defaultMenu = () => JSON.parse(fs.readFileSync(defaultMenuPath, 'utf8'));

  function readMenu() {
    if (!fs.existsSync(menuPath())) {
      fs.mkdirSync(userDir(), { recursive: true });
      fs.writeFileSync(menuPath(), JSON.stringify(defaultMenu(), null, 2));
    }
    const m = JSON.parse(fs.readFileSync(menuPath(), 'utf8'));
    const v = validateMenu(m);
    if (!v.ok) throw new Error(v.errors.slice(0, 3).join('; '));
    if (migrate(m)) writeMenu(m);
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
    readMenu,
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

module.exports = { createStore, MODELS, MODEL_LABELS, AI_FIELDS, SHORTCUT_FIELDS };
