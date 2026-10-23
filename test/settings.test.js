const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ini = require('../src/main/ini');
const HK = require('../src/common/hotkeys');
const { classify } = require('../src/main/conflicts');
const { createStore, MODELS } = require('../src/main/settings-store');
const { createBridge } = require('../src/main/bridge');

test('ini keeps sections, writes CRLF and plain ASCII', () => {
  const s = ini.parse('[API]\r\nApiKey=abc\r\nModel=m\r\n[Behavior]\r\nHotkey=^!q\r\n');
  assert.strictEqual(ini.get(s, 'API', 'ApiKey'), 'abc');
  ini.set(s, 'Impression', 'ExtraRules', 'Keep it short \u2014 no \u201Cnumbers\u201D');
  const out = ini.serialize(s);
  assert.match(out, /\r\n\[Impression\]\r\nExtraRules=Keep it short - no "numbers"\r\n$/);
  assert.ok(/^[\x00-\x7F]*$/.test(out));
});

test('hotkeys: record from a key press, show nicely, find clashes', () => {
  assert.strictEqual(HK.fromEvent({ code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true }), '^!j');
  assert.strictEqual(HK.fromEvent({ code: 'CapsLock', key: 'CapsLock', ctrlKey: true }), '^CapsLock');
  assert.strictEqual(HK.fromEvent({ code: 'ControlLeft', key: 'Control', ctrlKey: true }), '');
  assert.strictEqual(HK.fromEvent({ code: 'KeyJ', key: 'j' }), '', 'a bare letter is not a shortcut');
  assert.strictEqual(HK.fromEvent({ code: 'F9', key: 'F9' }), 'F9');
  assert.strictEqual(HK.pretty('^CapsLock'), 'Ctrl+CapsLock');
  assert.strictEqual(HK.pretty('!+l'), 'Alt+Shift+L');
  assert.ok(HK.same('!+l', '+!L'));
  const known = [{ key: '^!g', script: 'Rad Optimizer', does: 'paste indication' }];
  assert.strictEqual(HK.clashes('^!G', known).length, 1);
  assert.strictEqual(HK.clashes('^!j', known).length, 0);
});

test('old tools that clash are recognised, our own processes are not', () => {
  const procs = [
    { ProcessId: 1, Name: 'radgesture.exe', ExecutablePath: 'C:\\new\\RadGesture.exe', CommandLine: '' },
    { ProcessId: 2, Name: 'radgesture.exe', ExecutablePath: 'C:\\Users\\s\\AppData\\Local\\radgesture\\app-2.3.0\\radgesture.exe', CommandLine: '' },
    { ProcessId: 3, Name: 'radgesture.exe', ExecutablePath: 'C:\\Users\\s\\AppData\\Local\\radgesture\\app-2.3.0\\radgesture.exe', CommandLine: '--type=gpu' },
    { ProcessId: 4, Name: 'AutoHotkey.exe', CommandLine: '"C:\\AHK\\AutoHotkey.exe" "C:\\tools\\RadProofread.ahk"' },
    { ProcessId: 5, Name: 'AutoHotkeyU64.exe', CommandLine: '"x" "C:\\tools\\Rad Optimizer.ahk"' },
    { ProcessId: 6, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\tools\\SomeOther.ahk"' },
    { ProcessId: 7, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\tools\\MyTimer.ahk"' },
    { ProcessId: 8, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\Program Files\\RadGesture\\resources\\helper\\RadGestureHelper.ahk"' },
  ];
  const found = classify(procs, { selfExe: 'C:\\new\\RadGesture.exe' });
  assert.deepStrictEqual(found.map((f) => f.pid), [2, 4]);
  assert.strictEqual(found[0].kind, 'old-radgesture');
});

test('settings store: AI and shortcut fields round-trip through RadGesture.ini', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-store-'));
  const store = createStore({ userDir: () => dir, defaultMenuPath: path.join(__dirname, '..', 'config', 'default-menu.json') });
  assert.strictEqual(store.readAI().model, 'claude-sonnet-5-5', 'defaults before any file exists');
  assert.strictEqual(store.readShortcuts().trigger, '^CapsLock');
  store.writeAI({ apiKey: 'k1', model: 'claude-haiku-5-5' });
  store.writeShortcuts({ proofread: '^!j' });
  const text = fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1');
  assert.match(text, /\[API\]\r\nApiKey=k1\r\nModel=claude-haiku-5-5/);
  assert.match(text, /\[Behavior\]\r\nHotkey=\^!j/);
  assert.strictEqual(store.readAI().apiKey, 'k1');
  const m = store.readMenu();
  assert.ok(m.categories.length >= 3, 'menu created from the default');
  assert.strictEqual(store.writeMenu({ categories: [] }).ok, false, 'a broken menu is refused');
});

test('bridge: paused show, done acks and the poll heartbeat', async () => {
  let polls = 0;
  const done = [];
  const b = createBridge({ token: 't', onShow: () => 'paused', onRelease: async () => 'none', onCancel() {}, isOpen: () => false,
    onPoll: () => polls++, onDone: (a) => done.push(a) });
  const port = await b.listen(47950);
  const call = (m, p) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { 'X-RG-Token': 't' } }).then((r) => r.text());
  try {
    assert.strictEqual(await call('POST', '/show'), 'paused');
    await call('GET', '/poll');
    await call('POST', '/done?action=keys:{F13}');
    assert.strictEqual(polls, 1);
    assert.deepStrictEqual(done, ['keys:{F13}']);
  } finally {
    await b.close();
  }
});

test('a retired model saved in the INI reads back as Sonnet 5.5', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-models-'));
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), '[API]\r\nApiKey=k\r\nModel=claude-sonnet-4-6\r\n');
  const store = createStore({ userDir: () => dir, defaultMenuPath: path.join(__dirname, '..', 'config', 'default-menu.json') });
  assert.strictEqual(store.readAI().model, 'claude-sonnet-5-5');
  assert.deepStrictEqual(MODELS, ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
});

test('API key: pasted junk is cleaned, wrong kinds of key are named', () => {
  const { cleanKey, keyProblem, errorText } = require('../src/common/apikey');
  assert.strictEqual(cleanKey('  sk-ant-api03-abc\r\n'), 'sk-ant-api03-abc');
  assert.strictEqual(cleanKey('"sk-ant-api03-abc"'), 'sk-ant-api03-abc');
  assert.strictEqual(cleanKey('x-api-key: sk-ant-api03-abc'), 'sk-ant-api03-abc');
  assert.strictEqual(cleanKey('sk-ant-api03-OLDsk-ant-api03-NEW'), 'sk-ant-api03-NEW', 'new key pasted after an old one');
  assert.strictEqual(keyProblem('sk-ant-api03-abc'), '');
  assert.strictEqual(keyProblem('sk-ant-usr-abc'), '', 'other Anthropic key kinds are let through to the API');
  assert.match(keyProblem('sk-ant-oat01-abc'), /login code/);
  assert.match(keyProblem('hello'), /does not look like/);
  assert.match(keyProblem('sk-proj-xyz'), /OpenAI/, 'an OpenAI key is named as one');
  assert.match(errorText(401, 'invalid x-api-key'), /not valid/);
});

test('settings store saves the cleaned key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-key-'));
  const store = createStore({ userDir: () => dir, defaultMenuPath: path.join(__dirname, '..', 'config', 'default-menu.json') });
  store.writeAI({ apiKey: ' sk-ant-api03-k1\n', model: 'claude-sonnet-5-5' });
  assert.match(fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1'), /ApiKey=sk-ant-api03-k1\r\n/);
});

test('PACS is the first ring, then AI Tools; an older menu is reordered once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-order-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const base = JSON.parse(fs.readFileSync(def, 'utf8'));
  assert.deepStrictEqual(base.categories.slice(0, 2).map((c) => c.id), ['pacs', 'ai'], 'the default menu');
  const old = [base.categories[1], base.categories[0], ...base.categories.slice(2)];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify({ ...base, categories: old }));
  let m = store.readMenu();
  assert.deepStrictEqual(m.categories.slice(0, 2).map((c) => c.id), ['pacs', 'ai']);
  // Put back in another order on purpose afterwards: left alone.
  m.categories.push(m.categories.shift());
  store.writeMenu(m);
  assert.strictEqual(store.readMenu().categories[0].id, 'ai');
});

test('functions that earlier builds saved off are switched on once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-on-'));
  const store = createStore({ userDir: () => dir, defaultMenuPath: path.join(__dirname, '..', 'config', 'default-menu.json') });
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), '[RadGesture]\r\nMigrated=prior-toolbar\r\n[Lib.PS_PasteIndication]\r\nOn=0\r\n[Lib.PS_ToggleDictation]\r\nOn=0\r\nHotkey=^!F4\r\n', 'latin1');
  assert.strictEqual(store.migrateIni(), true);
  const t = fs.readFileSync(path.join(dir, 'RadGesture.ini'), 'latin1');
  assert.match(t, /\[Lib\.PS_PasteIndication\]\r\nOn=1/);
  assert.match(t, /\[Lib\.PS_ToggleDictation\]\r\nOn=1\r\nHotkey=\^!F4/);
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), t.replace('[Lib.PS_PasteIndication]\r\nOn=1', '[Lib.PS_PasteIndication]\r\nOn=0'), 'latin1');
  assert.strictEqual(store.migrateIni(), false, 'turned off on purpose afterwards: stays off');
});

test('an older RadGesture.ini gets the Priors toolbar back once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-ini-'));
  const store = createStore({ userDir: () => dir, defaultMenuPath: path.join(__dirname, '..', 'config', 'default-menu.json') });
  assert.strictEqual(store.migrateIni(), false, 'no INI yet: nothing to do');
  fs.writeFileSync(path.join(dir, 'RadGesture.ini'), '[API]\r\nModel=claude-sonnet-5-5\r\n[Priors]\r\nShowAtStartup=0\r\n', 'latin1');
  assert.strictEqual(store.migrateIni(), true);
  assert.strictEqual(store.readAI().toolbarAtStartup, '1');
  assert.strictEqual(store.readAI().model, 'claude-sonnet-5-5', 'other settings are kept');
  store.writeAI({ toolbarAtStartup: '0' }); // turned off on purpose afterwards
  assert.strictEqual(store.migrateIni(), false);
  assert.strictEqual(store.readAI().toolbarAtStartup, '0', 'and stays off');
});

test('an older menu gets Orthogonal moved next to Distance, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-orth-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const pacs = m.categories.find((c) => c.id === 'pacs');
  const meas = pacs.items.find((i) => i.name === 'Measure');
  const cross = pacs.items.find((i) => i.name === 'Crosshair & link');
  cross.name = 'Crosshair'; // as older builds named it
  const names = (b) => b.items.map((i) => i.name);
  assert.deepStrictEqual(names(meas).slice(0, 2), ['Distance', 'Orthogonal'], 'the default menu already has it there');
  // An older saved menu: Orthogonal still under Crosshair, pressing Rad Optimizer's key.
  cross.items.push(Object.assign(meas.items.splice(1, 1)[0], { action: 'helper:keys:^!o' }));
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu().categories.find((c) => c.id === 'pacs');
  assert.deepStrictEqual(names(got.items.find((i) => i.name === 'Measure')).slice(0, 2), ['Distance', 'Orthogonal']);
  assert.ok(!names(got.items.find((i) => i.name === 'Crosshair & link')).includes('Orthogonal'));
});

test('an older menu loses Lung-RADS, gets paired icons and clearer names, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-nav-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const sub = (menu, ring, name) => menu.categories.find((c) => c.id === ring).items.find((i) => i.name === name);
  // As an older build saved it.
  const ps = sub(m, 'pacs', 'PowerScribe');
  ps.items.unshift({ name: 'Lung-RADS (auto)', icon: 'pulmonology', action: 'helper:lungrads' });
  ps.items.push({ name: 'Lung screening 2', icon: 'pulmonology', action: 'helper:lib:LungScreening2' });
  ps.items.forEach((i) => { if (/Field/.test(i.action)) i.icon = 'field'; });
  const cross = sub(m, 'pacs', 'Crosshair & link');
  cross.name = 'Crosshair';
  cross.items[1].name = 'Link crosshair';
  sub(m, 'pacs', 'Layout').items[0].icon = 'arrow_back';
  const pri = sub(m, 'ai', 'Prior checklist');
  pri.name = 'Priors';
  pri.items[1].name = 'Checklist';
  pri.items[2].name = 'Clear priors';
  // One the person set themselves stays.
  sub(m, 'pacs', 'Key images').items[1].icon = 'star';
  sub(m, 'pacs', 'Key images').items[0].icon = 'arrow_back';
  // A ring holding only Lung-RADS goes with it.
  m.categories.find((c) => c.id === 'apps').items.push({ name: 'Lung', icon: 'pulmonology', items: [{ name: 'Lung-RADS', icon: 'pulmonology', action: 'helper:lungrads' }] });
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu();
  const flat = [];
  (function w(a) { for (const x of a) { flat.push(x); if (x.items) w(x.items); } })(got.categories.flatMap((c) => c.items));
  assert.ok(!flat.some((i) => /lungrads|LungScreening2/.test(i.action || '')), 'no Lung-RADS left');
  assert.ok(!flat.some((i) => i.name === 'Lung' && Array.isArray(i.items)), 'the empty smaller ring is gone');
  assert.deepStrictEqual(sub(got, 'pacs', 'PowerScribe').items.map((i) => i.icon), ['keyboard_tab_rtl', 'keyboard_tab']);
  assert.deepStrictEqual(sub(got, 'pacs', 'Crosshair & link').items.map((i) => i.name), ['Crosshair', 'Link priors']);
  assert.strictEqual(sub(got, 'pacs', 'Layout').items[0].icon, 'skip_previous');
  assert.deepStrictEqual(sub(got, 'pacs', 'Key images').items.map((i) => i.icon), ['fast_rewind', 'star']);
  assert.deepStrictEqual(sub(got, 'ai', 'Prior checklist').items.map((i) => i.name), ['Add copied prior', 'Make checklist', 'Empty the list', 'Show toolbar']);
});

test('an older menu: the AI ring\'s Settings becomes AI settings, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-ais-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const ai = (menu) => menu.categories.find((c) => c.id === 'ai');
  const s = ai(m).items.find((i) => i.name === 'AI settings');
  s.name = 'Settings';
  s.items[0].name = 'AI settings';
  s.items[2].name = 'Edit this menu';
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = ai(store.readMenu()).items.find((i) => i.name === 'AI settings');
  assert.ok(got, 'renamed');
  assert.deepStrictEqual(got.items.map((i) => i.name), ['Key and model', 'Proofread history', 'Edit rings']);
});

test('an older menu loses Paste indication from the ring, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-pi-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const ps = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'PowerScribe');
  assert.ok(!ps(m).items.some((i) => i.action === 'helper:keys:^!g'), 'not in the default menu');
  ps(m).items.splice(1, 0, { name: 'Paste indication', icon: 'content_paste', action: 'helper:keys:^!g' });
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  assert.ok(!ps(store.readMenu()).items.some((i) => i.action === 'helper:keys:^!g'));
});
