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

const MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7'];

// INI field <-> settings field, with the helper's own defaults.
const AI_FIELDS = {
  apiKey: ['API', 'ApiKey', ''],
  model: ['API', 'Model', 'claude-sonnet-4-6'],
  sensitivity: ['Behavior', 'Sensitivity', 'moderate'],
  impressionRules: ['Impression', 'ExtraRules', 'Keep it very short. No measurements or other numbers.'],
  priorExpireMinutes: ['Priors', 'ExpireMinutes', '30'],
  priorCapture: ['Priors', 'CaptureMode', 'clipboard'],
  toolbarAtStartup: ['Priors', 'ShowAtStartup', '0'],
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
    writeMenu,
    readAI: () => readFields(AI_FIELDS),
    writeAI: (v) => writeFields(AI_FIELDS, v),
    readShortcuts: () => readFields(SHORTCUT_FIELDS),
    writeShortcuts: (v) => writeFields(SHORTCUT_FIELDS, v),
  };
}

module.exports = { createStore, MODELS, AI_FIELDS, SHORTCUT_FIELDS };
