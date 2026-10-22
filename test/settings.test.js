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
    { ProcessId: 6, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\tools\\LungRADS.ahk"' },
    { ProcessId: 7, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\tools\\RadStopwatch.ahk"' },
    { ProcessId: 8, Name: 'AutoHotkey.exe', CommandLine: '"x" "C:\\Program Files\\RadGesture\\resources\\helper\\RadGestureHelper.ahk"' },
  ];
  const found = classify(procs, { selfExe: 'C:\\new\\RadGesture.exe' });
  assert.deepStrictEqual(found.map((f) => f.pid), [2, 4, 6]);
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

test('an older menu loses the shipped Stopwatch ring once, a home-made one stays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-mig-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const base = JSON.parse(fs.readFileSync(def, 'utf8'));
  const shipped = { id: 'stopwatch', name: 'Stopwatch', color: '#5fd38d', icon: 'timer', items: [
    { name: 'Start study (F4)', icon: 'play_arrow', action: 'helper:keys:{F4}' },
    { name: 'Stop / sign (F12)', icon: 'stop', action: 'helper:keys:{F12}' }] };
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify({ ...base, categories: [...base.categories, shipped] }));
  let m = store.readMenu();
  assert.ok(!m.categories.some((c) => c.id === 'stopwatch'), 'the shipped Stopwatch ring is removed');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'menu.json'), 'utf8')).migrated.includes('no-stopwatch-ring'), 'and that is saved');
  // Added back by hand afterwards: left alone.
  m.categories.push(shipped);
  store.writeMenu(m);
  assert.ok(store.readMenu().categories.some((c) => c.id === 'stopwatch'));
  // A Stopwatch ring the person added to: never removed.
  const mine = { ...shipped, items: [...shipped.items, { name: 'Open RadStopwatch', icon: 'timer', action: 'app:C:\\RadStopwatch\\RadStopwatch.ahk' }] };
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify({ ...base, categories: [...base.categories, mine] }));
  assert.ok(store.readMenu().categories.some((c) => c.id === 'stopwatch'));
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
  const cross = pacs.items.find((i) => i.name === 'Crosshair');
  const names = (b) => b.items.map((i) => i.name);
  assert.deepStrictEqual(names(meas).slice(0, 2), ['Distance', 'Orthogonal'], 'the default menu already has it there');
  // An older saved menu: Orthogonal still under Crosshair.
  cross.items.push(meas.items.splice(1, 1)[0]);
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu().categories.find((c) => c.id === 'pacs');
  assert.deepStrictEqual(names(got.items.find((i) => i.name === 'Measure')).slice(0, 2), ['Distance', 'Orthogonal']);
  assert.ok(!names(got.items.find((i) => i.name === 'Crosshair')).includes('Orthogonal'));
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
