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


// The PACS ring's PowerScribe smaller ring, as builds before pacs-no-fields
// shipped it (older menus are built from the default menu plus this).
const withPS = (m) => {
  const pacs = m.categories.find((c) => c.id === 'pacs');
  pacs.items = pacs.items.filter((i) => i.action !== 'helper:lib:PACS_Show_Report'); // newer than those menus
  pacs.items.push({ name: 'PowerScribe', icon: 'mic', items: [
    { name: 'Previous field', icon: 'keyboard_tab_rtl', action: 'helper:lib:PS_PrevField' },
    { name: 'Next field', icon: 'keyboard_tab', action: 'helper:lib:PS_NextField' }] });
  return m;
};

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
  withPS(m);
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
  sub(m, 'pacs', 'Key images & exams').items[1].icon = 'star';
  sub(m, 'pacs', 'Key images & exams').items[0].icon = 'arrow_back';
  // A ring holding only Lung-RADS goes with it.
  m.categories.find((c) => c.id === 'apps').items.push({ name: 'Lung', icon: 'pulmonology', items: [{ name: 'Lung-RADS', icon: 'pulmonology', action: 'helper:lungrads' }] });
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu();
  const flat = [];
  (function w(a) { for (const x of a) { flat.push(x); if (x.items) w(x.items); } })(got.categories.flatMap((c) => c.items));
  assert.ok(!flat.some((i) => /lungrads|LungScreening2/.test(i.action || '')), 'no Lung-RADS left');
  assert.ok(!flat.some((i) => i.name === 'Lung' && Array.isArray(i.items)), 'the empty smaller ring is gone');
  assert.strictEqual(sub(got, 'pacs', 'PowerScribe'), undefined, 'the field keys left the PACS ring');
  assert.deepStrictEqual(sub(got, 'pacs', 'Crosshair & link').items.map((i) => i.name), ['Crosshair', 'Link priors', 'Pinpoint']);
  assert.strictEqual(sub(got, 'pacs', 'Layout').items[0].icon, 'skip_previous');
  assert.deepStrictEqual(sub(got, 'pacs', 'Key images & exams').items.map((i) => i.icon), ['fast_forward', 'star', 'arrow_downward', 'arrow_upward']);
  assert.deepStrictEqual(sub(got, 'ai', 'Prior checklist').items.map((i) => i.name), ['Add copied prior', 'Make checklist', 'Empty the list', 'Show toolbar']);
});

test('an older menu gets the Grid of fixed layouts in PACS > Layout, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-grid-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const lay = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'Layout');
  const shipped = lay(m).items.find((i) => i.name === 'Grid');
  assert.deepStrictEqual(shipped.items.map((i) => i.name), ['2 × 2', '3 × 2', '3 × 3']);
  lay(m).items = lay(m).items.filter((i) => i.name !== 'Grid'); // as older builds saved it
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = lay(store.readMenu());
  assert.deepStrictEqual(got.items.map((i) => i.name), lay(JSON.parse(fs.readFileSync(def, 'utf8'))).items.map((i) => i.name), 'Grid lands after Next layout');
  assert.deepStrictEqual(got.items.find((i) => i.name === 'Grid'), shipped, 'the same Grid the default menu ships');
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
  withPS(m);
  ps(m).items.splice(1, 0, { name: 'Paste indication', icon: 'content_paste', action: 'helper:keys:^!g' });
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  assert.strictEqual(ps(store.readMenu()), undefined, 'and then the field keys leave too, taking the ring');
});

test('rings saved with six layouts keep only 2x2, 3x2 and 3x3, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-grid3-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const grid = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'Layout').items.find((i) => i.name === 'Grid');
  grid(m).items = ['2x1', '2x2', '2x3', '3x1', '3x2', '3x3'].map((k) => ({ name: k, icon: 'grid:' + k, action: 'helper:lib:PACS_Layout_' + k }));
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  assert.deepStrictEqual(grid(store.readMenu()).items.map((i) => i.action.split('_').pop()), ['2x2', '3x2', '3x3']);
});

test('rings saved with "back" beside "play" get matching previous/next icons, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-pairs-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const pacs = (menu) => menu.categories.find((c) => c.id === 'pacs');
  const sub = (menu, n) => pacs(menu).items.find((i) => i.name === n).items;
  // As an early build saved them: key presses, "back" and "play".
  sub(m, 'Key images & exams').splice(0, 2,
    { name: 'Previous key image', icon: 'back', action: 'helper:keys:^!k' },
    { name: 'Next key image', icon: 'play', action: 'helper:keys:^!i' });
  const lay = sub(m, 'Layout');
  lay.find((i) => i.action === 'helper:lib:PACS_Prev_Layout').icon = 'back';
  lay.find((i) => i.action === 'helper:lib:PACS_Next_Layout').icon = 'star'; // the person's own choice stays
  withPS(m);
  const ps = sub(m, 'PowerScribe');
  ps.find((i) => i.action === 'helper:lib:PS_PrevField').icon = 'arrow_back';
  ps.find((i) => i.action === 'helper:lib:PS_NextField').icon = 'play';
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'pacs-no-fields'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu();
  const icon = (n, name) => sub(got, n).find((i) => i.name === name).icon;
  assert.strictEqual(icon('Key images & exams', 'Previous key image'), 'fast_rewind');
  assert.strictEqual(icon('Key images & exams', 'Next key image'), 'fast_forward');
  assert.strictEqual(icon('Layout', 'Previous layout'), 'skip_previous');
  assert.strictEqual(icon('Layout', 'Next layout'), 'star');
  assert.strictEqual(icon('PowerScribe', 'Previous field'), 'keyboard_tab_rtl');
  assert.strictEqual(icon('PowerScribe', 'Next field'), 'keyboard_tab');
});

test('every previous/next pair the app ships uses one matching pair of icons', () => {
  const def = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default-menu.json'), 'utf8'));
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'library.json'), 'utf8'));
  const PAIRS = { skip_previous: 'skip_next', fast_rewind: 'fast_forward', keyboard_tab_rtl: 'keyboard_tab', arrow_downward: 'arrow_upward' };
  const items = [];
  const walk = (list) => (list || []).forEach((it) => (it.items ? walk(it.items) : items.push(it)));
  def.categories.forEach((c) => walk(c.items));
  const all = items.map((i) => ({ name: i.name, icon: i.icon })).concat(lib.functions.map((f) => ({ name: f.name, icon: f.icon })));
  for (const p of all.filter((x) => /^previous /i.test(x.name))) {
    const n = all.find((x) => x.name.toLowerCase() === p.name.toLowerCase().replace(/^previous /, 'next '));
    assert.ok(n, 'a Next for ' + p.name);
    assert.strictEqual(PAIRS[p.icon], n.icon, `${p.name} (${p.icon}) and ${n.name} (${n.icon}) are one pair`);
  }
});

test('Orthogonal gets the L-shaped ruler in place of a shipped grid icon, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-ortho-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const measure = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'Measure').items;
  measure(m).find((i) => i.name === 'Orthogonal').icon = 'grid';
  measure(m).find((i) => i.name === 'Distance').icon = 'grid'; // not Orthogonal: stays
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = measure(store.readMenu());
  assert.strictEqual(got.find((i) => i.name === 'Orthogonal').icon, 'ti:ruler');
  assert.strictEqual(got.find((i) => i.name === 'Distance').icon, 'grid');
});

test('"Search copied text" becomes Search selection: OpenEvidence and Google Images join, the Apps search window leaves, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-oe-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const gal = (menu) => menu.categories.find((c) => c.id === 'gallery');
  const search = (menu, n) => gal(menu).items.find((i) => i.name === n);
  // As saved before: the old name, no OpenEvidence or Google Images, and
  // the search window on the Apps ring.
  const old = search(m, 'Search selection');
  old.name = 'Search copied text';
  old.items = old.items.filter((i) => i.action !== 'helper:oe:clip' && !/tbm=isch/.test(i.action));
  m.categories.find((c) => c.id === 'apps').items.push({ name: 'Search selection', icon: 'travel_explore', action: 'helper:lib:SearchRadiopaediaGoogle' });
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs', 'orthogonal-ruler'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const want = ['Radiopaedia', 'Google', 'Google Images', 'OpenEvidence'];
  assert.deepStrictEqual(search(store.readMenu(), 'Search selection').items.map((i) => i.name), want);
  assert.deepStrictEqual(search(store.readMenu(), 'Search selection').items.map((i) => i.name), want, 'not added twice');
  const apps = store.readMenu().categories.find((c) => c.id === 'apps');
  assert.ok(!JSON.stringify(apps).includes('SearchRadiopaediaGoogle'), 'one search: the old search window is off the Apps ring');
  assert.ok(require('../config/library.json').functions.some((f) => f.id === 'SearchRadiopaediaGoogle'), 'its function (and shortcut) stays');
});

test('the field keys leave the PACS ring, keeping what the person added there, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-fields-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = withPS(JSON.parse(fs.readFileSync(def, 'utf8')));
  const ps = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'PowerScribe');
  ps(m).items.push({ name: 'Sign', icon: 'draw', action: 'helper:keys:{F12}' });
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs', 'orthogonal-ruler', 'openevidence-search'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  assert.deepStrictEqual(ps(store.readMenu()).items.map((i) => i.name), ['Sign']);
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'library.json'), 'utf8'));
  assert.ok(['PS_PrevField', 'PS_NextField'].every((id) => lib.functions.find((f) => f.id === id && f.on && f.hotkey)), 'still functions with their shortcuts');
});

test('window / level presets show their organ and Oncologic the ribbon, on saved rings too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-organs-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const flat = (menu) => { const o = {}; (function w(a) { for (const x of a) { if (x.items) w(x.items); else o[x.action] = x; } })(menu.categories.flatMap((c) => c.items)); return o; };
  const old = { PACS_WL_SoftTissue: 'contrast', PACS_WL_Bone: 'skeleton', PACS_WL_Brain: 'neurology', PACS_WL_Stroke: 'star' };
  for (const [id, icon] of Object.entries(old)) flat(m)['helper:lib:' + id].icon = icon;
  flat(m)['helper:oneliner:oncologic'].icon = 'oncology';
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs', 'orthogonal-ruler', 'openevidence-search', 'pacs-no-fields'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = flat(store.readMenu());
  assert.strictEqual(got['helper:lib:PACS_WL_SoftTissue'].icon, 'gastroenterology');
  assert.strictEqual(got['helper:lib:PACS_WL_Bone'].icon, 'ti:bone');
  assert.strictEqual(got['helper:lib:PACS_WL_Brain'].icon, 'ti:brain');
  assert.strictEqual(got['helper:lib:PACS_WL_Stroke'].icon, 'star', 'an icon the person chose stays');
  assert.strictEqual(got['helper:oneliner:oncologic'].icon, 'ti:ribbon-health');
});

test('saved AI Tools rings get "Learn this impression" after Impression, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-style-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const ai = (menu) => menu.categories.find((c) => c.id === 'ai');
  ai(m).items = ai(m).items.filter((i) => i.action !== 'helper:style:learn');
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs', 'orthogonal-ruler', 'openevidence-search', 'pacs-no-fields', 'organ-icons'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = ai(store.readMenu()).items.map((i) => i.action || i.name);
  assert.strictEqual(got[got.indexOf('helper:impression') + 1], 'helper:style:learn');
  assert.strictEqual(got.filter((a) => a === 'helper:style:learn').length, 1);
});

test('saved PACS rings get the Image ring (MPR moved in), Pinpoint, Show report, and previous/next that keep the ring open, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-pacsimg-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  // As the last build shipped it.
  const pacs = (menu) => menu.categories.find((c) => c.id === 'pacs');
  const p = pacs(m);
  const img = p.items.find((i) => i.name === 'Image');
  const mpr = img.items.find((i) => i.action === 'helper:lib:PACS_MPR');
  Object.assign(img, { name: 'Enhance', icon: 'wand_stars', items: img.items.filter((i) => /PACS_(Enhance|Sharpen)$/.test(i.action)) });
  p.items.find((i) => i.name === 'Layout').items.splice(3, 0, mpr);
  p.items.find((i) => i.name === 'Crosshair & link').items.pop();
  p.items = p.items.filter((i) => i.name !== 'Show report');
  (function strip(a) { for (const i of a) { delete i.stay; if (i.items) strip(i.items); } })(p.items);
  p.items.find((i) => i.name === 'Key images & exams').items[1].stay = false; // the person's own choice stays
  m.migrated = ['orthogonal-in-measure', 'no-paste-indication', 'library', 'chart-bin', 'reference-library', 'reference-library-title', 'pacs-first', 'no-lung', 'nav-names', 'ai-settings', 'layout-grid', 'layout-grid-three', 'nav-pairs', 'orthogonal-ruler', 'openevidence-search', 'pacs-no-fields', 'organ-icons'];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = pacs(store.readMenu());
  const names = (n) => got.items.find((i) => i.name === n).items.map((i) => i.name);
  assert.deepStrictEqual(names('Image'), ['MPR', 'Thick slab', 'Slab off', 'Invert', 'Enhance', 'Sharpen', 'Reset']);
  assert.ok(!names('Layout').includes('MPR'), 'MPR left Layout');
  assert.deepStrictEqual(names('Crosshair & link'), ['Crosshair', 'Link priors', 'Pinpoint']);
  assert.strictEqual(got.items[got.items.length - 1].name, 'Show report');
  const stay = (n) => got.items.find((i) => i.name === n).items.filter((i) => i.stay).map((i) => i.name);
  assert.deepStrictEqual(stay('Layout'), ['Previous layout', 'Next layout']);
  assert.deepStrictEqual(stay('Key images & exams'), ['Next key image']);
  // The shipped menu is the same.
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(def, 'utf8')).categories.find((c) => c.id === 'pacs').items.map((i) => i.name), got.items.map((i) => i.name));
});

test('saved rings: the ring keeps its bullseye, Crosshair becomes a plus, Pinpoint the bullseye, Link priors a chain, and the one-liner loses Indication, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-xhair-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const all = (menu) => { const o = []; (function w(a) { for (const x of a) { o.push(x); if (x.items) w(x.items); } })(menu.categories.flatMap((c) => c.items)); return o; };
  const by = (menu, act) => all(menu).find((x) => x.action === act);
  by(m, 'helper:lib:PACS_Crosshair').icon = 'my_location';
  by(m, 'helper:lib:PACS_LinkCrosshair').icon = 'gps_not_fixed'; // not one we shipped: still becomes the chain
  const k0 = all(m).find((x) => x.name === 'Key images & exams'); k0.name = 'Key images'; k0.items = k0.items.slice(0, 2);
  all(m).find((x) => x.name === 'Crosshair & link').icon = 'ti:plus';
  by(m, 'helper:lib:PACS_Pinpoint').icon = 'ti:focus-2';
  const ol = all(m).find((x) => x.items && x.items.some((i) => i.action === 'helper:oneliner:oncologic'));
  ol.items.push({ name: 'Indication', icon: 'assignment', action: 'helper:oneliner:indication' });
  m.migrated = [];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const got = store.readMenu();
  assert.strictEqual(by(got, 'helper:lib:PACS_Crosshair').icon, 'ti:plus');
  assert.strictEqual(all(got).find((x) => x.name === 'Crosshair & link').icon, 'my_location', 'the ring keeps its bullseye');
  assert.strictEqual(by(got, 'helper:lib:PACS_Pinpoint').icon, 'my_location');
  assert.strictEqual(by(got, 'helper:lib:PACS_LinkCrosshair').icon, 'ti:link');
  assert.ok(!by(got, 'helper:oneliner:indication'), 'Indication is gone from the one-liner');
  assert.ok(by(got, 'helper:oneliner:oncologic'), 'the other one-liners stay');
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'library.json'), 'utf8'));
  assert.ok(JSON.stringify(lib).includes('PS_PasteIndication'), 'Paste indication stays a function');
  const ki = all(got).find((x) => x.name === 'Key images & exams');
  assert.deepStrictEqual(ki.items.slice(-2).map((x) => [x.action, x.stay]), [['helper:lib:PACS_Prev_Exam', true], ['helper:lib:PACS_Next_Exam', true]]);
});

test('Key images & exams: next above previous, images on the right and exams on the left, once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-kiorder-'));
  const def = path.join(__dirname, '..', 'config', 'default-menu.json');
  const store = createStore({ userDir: () => dir, defaultMenuPath: def });
  const m = JSON.parse(fs.readFileSync(def, 'utf8'));
  const ki = (menu) => menu.categories.find((c) => c.id === 'pacs').items.find((i) => i.name === 'Key images & exams');
  const byName = Object.fromEntries(ki(m).items.map((i) => [i.name, i]));
  ki(m).items = ['Previous key image', 'Next key image', 'Previous exam', 'Next exam'].map((n) => byName[n]); // as an earlier build saved it
  m.migrated = [];
  fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(m));
  const order = ki(store.readMenu()).items.map((i) => i.name);
  assert.deepStrictEqual(order, ['Next key image', 'Previous key image', 'Previous exam', 'Next exam']);
  // Opened below the PACS ring (way back up): upper right, lower right, lower left, upper left.
  const G = require('../src/renderer/geometry');
  const pacs = JSON.parse(fs.readFileSync(def, 'utf8')).categories.find((c) => c.id === 'pacs');
  const at = pacs.items.findIndex((i) => i.name === 'Key images & exams') * 360 / pacs.items.length;
  assert.strictEqual(at, 180, 'the ring opens straight down');
  assert.deepStrictEqual(G.slotAngles(4, 0).items, [72, 144, 216, 288]);
});
