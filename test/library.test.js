// The function library: Rad Optimizer's functions, built into the helper.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HK = require('../src/common/hotkeys');
const KS = require('../src/common/keyset');
const { createStore, migrate, optimizerKeyMap } = require('../src/main/settings-store');
const { codeFor, functionSource, CODE_FUNCS } = require('../src/main/library-code');
const ini = require('../src/main/ini');

const root = path.join(__dirname, '..');
// A person's name, built from parts so this file does not carry it.
const PERSON = new RegExp(['\\b' + 'Si' + 'na\\b', 'Maz' + 'aheri', 'maz' + 'aheri\\.si' + 'na'].join('|'), 'i');
const lib = JSON.parse(fs.readFileSync(path.join(root, 'config/library.json'), 'utf8'));
const ahk = fs.readFileSync(path.join(root, 'helper/RadGestureHelper.ahk'), 'utf8');
const defaultMenu = JSON.parse(fs.readFileSync(path.join(root, 'config/default-menu.json'), 'utf8'));

const helperIds = () => {
  const m = ahk.match(/global LIB_IDS := ((?:"[^"]*"\s*(?:\.\s*)?)+)/);
  return m[1].match(/"([^"]*)"/g).map((s) => s.slice(1, -1)).join('').split('|');
};

test('library.json: unique ids, known groups and targets, valid shortcuts and keys', () => {
  const ids = lib.functions.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const f of lib.functions) {
    assert.ok(lib.groups.includes(f.group), `${f.id}: group ${f.group}`);
    assert.ok(f.name && f.description && f.icon, f.id);
    if (f.target) assert.ok(lib.targets[f.target], `${f.id}: target ${f.target}`);
    if (f.hotkey) assert.ok(HK.parse(f.hotkey).key, `${f.id}: hotkey ${f.hotkey}`);
    for (const p of f.params || []) {
      assert.ok(['key', 'bool', 'list'].includes(p.type), `${f.id}.${p.name}`);
      if (p.type === 'key' && p.default) assert.ok(KS.sendToHotkey(p.default), `${f.id}.${p.name}: ${p.default}`);
      if (p.type === 'bool') assert.ok(['0', '1'].includes(p.default));
    }
    if (f.target) assert.ok((f.params || []).some((p) => p.name === 'Key'), `${f.id} needs a Key`);
  }
});

test('the helper knows exactly the library functions in library.json', () => {
  assert.deepStrictEqual(helperIds().sort(), lib.functions.map((f) => f.id).sort());
  const body = ahk.slice(ahk.indexOf('LibRun(id) {'), ahk.indexOf('LibWindow(target) {'));
  for (const f of lib.functions) {
    if (f.target) continue; // LibPress, from the Target setting
    assert.ok(body.includes(`(id = "${f.id}")`), `LibRun has no branch for ${f.id}`);
  }
  for (const t of Object.keys(lib.targets)) assert.ok(ahk.includes(`(target = "${t}")`), `LibWindow does not know ${t}`);
});

test('no two library functions share a default shortcut, and none takes a RadGesture key', () => {
  const seen = new Map();
  for (const f of lib.functions.filter((x) => x.hotkey)) {
    const k = HK.pretty(f.hotkey);
    assert.ok(!seen.has(k), `${f.id} and ${seen.get(k)} both use ${k}`);
    seen.set(k, f.id);
  }
  for (const own of ['^!q', '^!u', '!+l', '^CapsLock']) assert.ok(!seen.has(HK.pretty(own)), own);
});

test('defaults: Rad Optimizer keys, every function on', () => {
  const f = (id) => lib.functions.find((x) => x.id === id);
  assert.strictEqual(f('PACS_WL_Lung').hotkey, '^!2');
  assert.strictEqual(f('PACS_Insert_Priors').hotkey, '^!p');
  assert.strictEqual(f('PACS_Insert_Priors').params[0].default, '^p');
  for (const x of lib.functions) assert.strictEqual(x.on, true, x.id);
  assert.strictEqual(f('PS_ToggleDictation').params.find((p) => p.name === 'SectraKey').default, '{F8}');
});

test('no work links, usernames or passwords in the library or the helper', () => {
  const text = JSON.stringify(lib) + ahk;
  assert.ok(!/kp\.org|sharepoint|onedrive|docs\.google\.com\/document/i.test(text));
  assert.ok(!/nuser\s*:=|npass\s*:=\s*"/.test(text));
  assert.ok(!/f\d{6}/i.test(JSON.stringify(lib)));
});

test('every ring button that runs a library function names a real one', () => {
  const ids = new Set(lib.functions.map((f) => f.id));
  const walk = (items) => items.forEach((it) => {
    if (it.items) return walk(it.items);
    if (it.action.startsWith('helper:lib:')) assert.ok(ids.has(it.action.slice(11)), it.action);
    assert.ok(!/^helper:keys:(\^!|\+!)/.test(it.action), `${it.name} still presses Rad Optimizer's ${it.action}`);
  });
  defaultMenu.categories.forEach((c) => walk(c.items));
});

test('a saved menu: Rad Optimizer keys become library functions, own keys stay', () => {
  const m = { categories: [{ id: 'pacs', name: 'PACS', items: [
    { name: 'Lung', icon: 'x', action: 'helper:keys:^!2' },
    { name: 'Mine', icon: 'x', action: 'helper:keys:2' },
    { name: 'Group', icon: 'x', items: [{ name: 'Priors', icon: 'x', action: 'helper:keys:^!p' }, { name: 'Epic', icon: 'x', action: 'helper:keys:+!e' }] },
  ] }] };
  assert.strictEqual(migrate(m, lib), true);
  assert.strictEqual(m.categories[0].items[0].action, 'helper:lib:PACS_WL_Lung');
  assert.strictEqual(m.categories[0].items[1].action, 'helper:keys:2');
  assert.strictEqual(m.categories[0].items[2].items[0].action, 'helper:lib:PACS_Insert_Priors');
  assert.strictEqual(m.categories[0].items[2].items[1].action, 'helper:lib:ActivateEPIC');
  assert.ok(m.migrated.includes('library'));
  // once only: a key put back by hand afterwards stays
  m.categories[0].items[1].action = 'helper:keys:^!3';
  migrate(m, lib);
  assert.strictEqual(m.categories[0].items[1].action, 'helper:keys:^!3');
  assert.strictEqual(optimizerKeyMap(lib).get('helper:keys:^!6'), 'helper:lib:PACS_WL_Stroke');
});

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-lib-'));
  return { dir, store: createStore({ userDir: () => dir, defaultMenuPath: path.join(root, 'config/default-menu.json'), libraryPath: path.join(root, 'config/library.json') }) };
}

test('the INI gets every library default before the helper starts, and keeps what a person chose', () => {
  const { dir, store } = tmpStore();
  assert.strictEqual(store.syncLibrary(), true);
  const read = () => ini.parse(fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1'));
  let s = read();
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'Hotkey'), '^!2');
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'On'), '1');
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'Key'), '2');
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'Target'), 'sectra');
  assert.strictEqual(ini.get(s, 'Lib.PS_ToggleDictation', 'On'), '1');
  assert.strictEqual(ini.get(s, 'Lib.PACS_Insert_Priors', 'Target', null), null);
  assert.strictEqual(store.syncLibrary(), false); // nothing missing now

  const v = store.readLibrary();
  v.values.PACS_WL_Lung.Key = 'l';
  v.values.PACS_WL_Lung.On = '0';
  v.values.OpenChromeTabs.Urls = 'https://a.example/|https://b.example/x%20y';
  v.username = '  someone  ';
  store.writeLibrary(v);
  store.syncLibrary();
  s = read();
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'Key'), 'l');
  assert.strictEqual(ini.get(s, 'Lib.PACS_WL_Lung', 'On'), '0');
  assert.strictEqual(ini.get(s, 'Library', 'Username'), 'someone');
  assert.strictEqual(store.readLibrary().values.OpenChromeTabs.Urls, 'https://a.example/|https://b.example/x%20y');
  // Target is not a setting: a hand-edited one is put back
  const raw = fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1').replace('Target=sectra', 'Target=notepad');
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), raw, 'latin1');
  store.syncLibrary();
  assert.strictEqual(ini.get(read(), 'Lib.PACS_WL_Lung', 'Target'), 'sectra');
});

test('the library keeps the rest of the INI as it was', () => {
  const { dir, store } = tmpStore();
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), '[API]\r\nApiKey=sk-ant-x\r\n[Behavior]\r\nHotkey=^!q\r\n', 'latin1');
  store.syncLibrary();
  const s = ini.parse(fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1'));
  assert.strictEqual(ini.get(s, 'API', 'ApiKey'), 'sk-ant-x');
  assert.strictEqual(ini.get(s, 'Behavior', 'Hotkey'), '^!q');
});

test('exported shortcut sets carry the library but never the username', () => {
  const { store } = tmpStore();
  store.syncLibrary();
  const v = store.readLibrary();
  v.username = 'someone';
  v.values.PACS_WL_Bone.Key = 'b';
  const set = KS.exportSet(defaultMenu, {}, v.values);
  assert.ok(!JSON.stringify(set).includes('someone'));
  const back = KS.importSet(JSON.parse(JSON.stringify(defaultMenu)), JSON.parse(JSON.stringify(set)));
  assert.strictEqual(back.library.PACS_WL_Bone.Key, 'b');
  assert.strictEqual(KS.importSet(defaultMenu, { format: KS.FORMAT, keys: [], library: [] }).library, null);
});

test('"Show the code" finds every library function in the helper', () => {
  const code = codeFor(lib, ahk, {});
  for (const f of lib.functions) assert.ok(code[f.id] && code[f.id].length > 20, `no code for ${f.id}`);
  assert.match(code.PACS_WL_Lung, /WinActivate, Image Window\n {4}Send, \{Ctrl up\}[^\n]*\n {4}Send, 2/);
  assert.match(code.PACS_Insert_Priors, /^; Insert priors: select the Comparison field/);
  assert.match(code.PACS_Insert_Priors, /Send, %sectraKey%\n {4}return true\n\}$/);
  for (const names of Object.values(CODE_FUNCS)) for (const n of names) assert.ok(functionSource(ahk, n), n);
  assert.match(functionSource(ahk, 'Lib_SearchRadiopaediaGoogle'), /return true\n\}$/);
});

test('a running Rad Optimizer is a clash once library shortcuts are on, not before', () => {
  const { classify } = require('../src/main/conflicts');
  const procs = [
    { ProcessId: 11, Name: 'Rad_Optimizer_5-8-26.exe', ExecutablePath: 'C:\\x\\Rad_Optimizer_5-8-26.exe', CommandLine: '"C:\\x\\Rad_Optimizer_5-8-26.exe"' },
    { ProcessId: 12, Name: 'AutoHotkeyU64.exe', ExecutablePath: 'C:\\AHK\\AutoHotkeyU64.exe', CommandLine: '"C:\\AHK\\AutoHotkeyU64.exe" "C:\\x\\Rad_Optimizer_5-8-26.ahk"' },
    { ProcessId: 13, Name: 'AutoHotkeyU64.exe', ExecutablePath: 'C:\\AHK\\AutoHotkeyU64.exe', CommandLine: '"C:\\AHK\\AutoHotkeyU64.exe" "C:\\x\\MyTimer.ahk"' },
  ];
  assert.deepStrictEqual(classify(procs, {}), []);
  const on = classify(procs, { libraryOn: true });
  assert.deepStrictEqual(on.map((c) => c.pid), [11, 12]);
  assert.ok(on.every((c) => c.optimizer && /Settings > Functions/.test(c.label)));
});

test('My functions: saved as their own AutoHotkey file, read back, deleted', () => {
  const { dir, store } = tmpStore();
  store.syncLibrary();
  const v = store.readLibrary();
  assert.deepStrictEqual(v.custom, []);
  v.custom = [{ id: 'myabc123', name: 'Ortho', description: 'Alt+O in Sectra', code: 'WinActivate, Image Window\nSend, !o' }];
  v.values.myabc123 = { On: '1', Hotkey: '^!+o' };
  store.writeLibrary(v);
  const file = path.join(dir, 'functions', 'myabc123.ahk');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('﻿'), 'UTF-8 with a BOM for AutoHotkey v1');
  assert.match(text, /#NoTrayIcon\r\n/);
  assert.match(text, /\r\nWinActivate, Image Window\r\nSend, !o\r\n/);
  const s = ini.parse(fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1'));
  assert.strictEqual(ini.get(s, 'Library', 'Custom'), 'myabc123');
  assert.strictEqual(ini.get(s, 'Lib.myabc123', 'Custom'), '1');
  assert.strictEqual(ini.get(s, 'Lib.myabc123', 'Hotkey'), '^!+o');
  const back = store.readLibrary();
  assert.deepStrictEqual(back.custom, [{ id: 'myabc123', name: 'Ortho', description: 'Alt+O in Sectra', code: 'WinActivate, Image Window\nSend, !o' }]);
  assert.strictEqual(back.values.myabc123.On, '1');
  // A bad id is never written (it becomes a file name).
  back.custom.push({ id: '..\\evil', name: 'x', code: 'x' });
  store.writeLibrary(back);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'functions')), ['myabc123.ahk']);
  // Deleted in Settings: its file and settings go.
  back.custom = [];
  store.writeLibrary(back);
  assert.ok(!fs.existsSync(file));
  const s2 = ini.parse(fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1'));
  assert.strictEqual(ini.get(s2, 'Lib.myabc123', 'Hotkey', null), null);
  assert.strictEqual(ini.get(s2, 'Library', 'Custom'), '');
});

test('the helper runs My functions with the AutoHotkey that ships next to it', () => {
  assert.ok(ahk.includes('if (LibParam(id, "Custom") = "1")'));
  assert.ok(ahk.includes('IniRead, mine, %INI_PATH%, Library, Custom'));
  assert.match(ahk, /LibAutoHotkey\(\) \{[\s\S]*AutoHotkeyU64\.exe/);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/build-windows.yml'), 'utf8');
  assert.ok(wf.includes('helper\\AutoHotkeyU64.exe'), 'CI puts AutoHotkey next to the helper');
  assert.ok(wf.includes('asset_name: RadGesture-portable.zip'), 'CI publishes the portable zip');
});

test('the Gallery ring becomes the Reference Library, once, unless renamed', () => {
  const m = { categories: [{ id: 'gallery', name: 'Gallery', items: [{ name: 'x', icon: 'x', action: 'url:https://a.example' }] }] };
  migrate(m, lib);
  assert.strictEqual(m.categories[0].name, 'Reference Library');
  const mine = { categories: [{ id: 'gallery', name: 'My links', items: [{ name: 'x', icon: 'x', action: 'url:https://a.example' }] }] };
  migrate(mine, lib);
  assert.strictEqual(mine.categories[0].name, 'My links');
  assert.strictEqual(defaultMenu.categories.find((c) => c.id === 'gallery').name, 'Reference Library');
});

test('Functions page filters: words, typed shortcuts, groups, programs, rings, clashes, sorting', () => {
  const FF = require('../src/common/fnfilter');
  const cards = lib.functions.map((f) => {
    const v = { On: f.on && f.id !== 'PS_ToggleDictation' ? '1' : '0', Hotkey: f.hotkey };
    for (const p of f.params || []) v[p.name] = p.default;
    return FF.card(f, v, f.id === 'PACS_WL_Lung' ? ['PACS > Window / level > Lung'] : [], f.id === 'PACS_MPR', '');
  });
  const ids = (fx) => FF.apply(cards, Object.assign(FF.fresh(), fx)).map((c) => c.id);
  assert.deepStrictEqual(ids({ q: 'lung win' }), ['PACS_WL_Lung']);
  assert.deepStrictEqual(ids({ q: 'ctrl+alt+p' }), ['PACS_Insert_Priors'], 'a typed shortcut finds what listens for it');
  assert.deepStrictEqual(ids({ q: 'alt+o' }), ['PACS_Orthogonal'], 'and what presses it in Sectra');
  assert.deepStrictEqual(ids({ key: '^p' }), ['PACS_Insert_Priors'], 'find by a recorded key');
  assert.ok(ids({ groups: ['Logins'] }).every((id) => /^Login/.test(id)));
  assert.deepStrictEqual(ids({ groups: ['PACS (Sectra)'], sub: 'Measure' }).length, 6);
  assert.ok(ids({ program: 'sectra' }).includes('PS_ToggleDictation'), 'dictation works in Sectra too (F8)');
  assert.ok(!ids({ program: 'powerscribe' }).includes('PACS_WL_Lung'));
  assert.deepStrictEqual(ids({ shortcut: 'none' }), ['PACS_Layout_2x2', 'PACS_Layout_3x2', 'PACS_Layout_3x3', 'PACS_Pinpoint', 'PACS_Show_Report', 'PACS_Thick_Slab', 'PACS_Slab_Off', 'PACS_Invert', 'PACS_Reset', 'LoginU', 'LoginForget']);
  assert.ok(ids({ shortcut: 'off' }).includes('PS_ToggleDictation'));
  assert.deepStrictEqual(ids({ ring: 'on' }), ['PACS_WL_Lung']);
  assert.deepStrictEqual(ids({ clash: true }), ['PACS_MPR']);
  assert.strictEqual(ids({ sort: 'az' })[0], 'PACS_Arrow');
  assert.strictEqual(FF.activeCount(Object.assign(FF.fresh(), { q: 'x', clash: true, sort: 'az' })), 2, 'sorting is not a filter');
  assert.strictEqual(FF.typedKey('lung'), '', 'a plain word is a word');
  assert.strictEqual(FF.typedKey('f4'), 'f4');
});

test('"Reference library" (first build) gets its capital L, once', () => {
  const m = { categories: [{ id: 'gallery', name: 'Reference library', items: [{ name: 'x', icon: 'x', action: 'url:https://a.example' }] }], migrated: ['reference-library'] };
  migrate(m, lib);
  assert.strictEqual(m.categories[0].name, 'Reference Library');
  const g = { categories: [{ id: 'gallery', name: 'Gallery', items: [{ name: 'x', icon: 'x', action: 'url:https://a.example' }] }] };
  migrate(g, lib);
  assert.strictEqual(g.categories[0].name, 'Reference Library');
});

test('what ships carries no personal names or development history', () => {
  const files = [];
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) walk(rel);
    else if (/\.(js|html|css|json|ahk)$/.test(e.name) && !/tabler-map|material-symbols/.test(e.name)) files.push(rel);
  });
  ['src', 'config', 'helper'].forEach(walk);
  files.push('tools/external_hotkeys.json');
  for (const f of files) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!PERSON.test(t) && !/RadStopwatch|3-16-26|5-8-26|; Change:|\bkp\.org\b/i.test(t), `${f} mentions a person or the project's history`);
  }
});

test('the one-liner\'s chart bin: on the One-liner ring, and added to saved rings once', () => {
  const ai = defaultMenu.categories.find((c) => c.id === 'ai');
  const ol = ai.items.find((it) => it.name === 'One-liner');
  assert.ok(ol.items.some((it) => it.action === 'helper:chart:add') && ol.items.some((it) => it.action === 'helper:chart:clear'));
  const old = { categories: [{ id: 'ai', name: 'AI Tools', items: [{ name: 'One-liner', icon: 'x', items: [
    { name: 'Full', icon: 'x', action: 'helper:oneliner:full' }, { name: 'Oncologic', icon: 'x', action: 'helper:oneliner:oncologic' }] }] }] };
  migrate(old, lib);
  assert.deepStrictEqual(old.categories[0].items[0].items.map((i) => i.action).slice(2), ['helper:chart:add', 'helper:chart:clear']);
  migrate(old, lib);
  assert.strictEqual(old.categories[0].items[0].items.length, 4, 'once');
  const run = ahk.slice(ahk.indexOf('RunFlavor(flavor) {'), ahk.indexOf('\nFlavorLabel(flavor) {'));
  assert.ok(run.includes('ChartAskEmpty()'), 'after a one-liner it asks whether to empty the bin');
  assert.ok(!/ChartClear\(/.test(run.slice(0, run.indexOf('ChartAskEmpty() {'))), 'and never empties it by itself');
  for (const l of ['ChartAsk_Empty:', 'ChartAsk_Keep:']) assert.ok(ahk.includes('\n' + l), l);
  assert.ok(/ChartExpireCheck\(\)\s*\n\s*if \(g_Chart\.Length\(\) > 0\)/.test(ahk), 'and expires when idle, like the priors');
});

test('the app is published as Avecina Studio, never a person', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.author, 'Avecina Studio', 'Windows shows this as the Publisher in Installed apps');
  assert.match(pkg.build.copyright, /Avecina Studio/);
  for (const t of [pkg.description, pkg.build.copyright, fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')]) {
    assert.ok(!PERSON.test(t), 'names a person: ' + t.slice(0, 80));
  }
});

test('no file in the repository names a person', () => {
  const files = require('child_process').execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = [];
  for (const f of files) {
    if (PERSON.test(f)) { hits.push(f); continue; }
    let t;
    try { t = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (t.includes('\u0000')) continue; // a picture or other binary file
    if (PERSON.test(t)) hits.push(f);
  }
  assert.deepStrictEqual(hits, [], 'names a person');
});
