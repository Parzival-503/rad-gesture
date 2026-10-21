const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const KS = require('../src/common/keyset');
const HK = require('../src/common/hotkeys');
const { validateMenu } = require('../src/common/menu');

const norm = (list) => list.map((k) => { const p = HK.parse(k); return p.mods + p.key; });
const menu = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default-menu.json'), 'utf8'));

test('keys: recorder spelling <-> Send spelling', () => {
  for (const [hot, send] of [['^!1', '^!1'], ['F4', '{F4}'], ['w', 'w'], ['^Space', '^{Space}'], ['+!i', '!+i'], ['Numpad3', '{Numpad3}'], ['^;', '^{;}']]) {
    assert.strictEqual(KS.hotkeyToSend(hot), send, hot);
    assert.ok(HK.same(KS.sendToHotkey(send), hot), send);
  }
  assert.strictEqual(KS.hotkeyToSend(''), '');
});

test('every key-pressing direction is listed with its path', () => {
  const items = KS.keyItems(menu());
  const soft = items.find((k) => k.path.join(' > ') === 'PACS > Window / level > Soft tissue');
  assert.ok(soft && soft.keys === '^!1');
  assert.ok(items.some((k) => k.path[0] === 'Apps' && HK.same(k.keys, '+!e')));
  assert.ok(items.every((k) => k.item.action.startsWith('helper:keys:')));
  assert.ok(items.length >= 28);
});

test('export -> import onto a menu with other keys restores them; layout untouched', () => {
  const mine = menu();
  const set = KS.exportSet(mine, { trigger: '^CapsLock' });
  const theirs = menu();
  KS.clearAll(theirs);
  theirs.categories[1].name = theirs.categories[1].name; // same names
  const r = KS.importSet(theirs, JSON.parse(JSON.stringify(set)));
  assert.ok(r.ok);
  assert.strictEqual(r.matched, KS.keyItems(mine).length);
  assert.deepStrictEqual(r.unmatched, []);
  assert.deepStrictEqual(norm(KS.keyItems(theirs).map((k) => k.keys)), norm(KS.keyItems(mine).map((k) => k.keys)));
  assert.strictEqual(r.shortcuts.trigger, '^CapsLock');
  assert.ok(validateMenu(theirs).ok);
});

test('import reports directions it could not find, and rejects other files', () => {
  const m = menu();
  const r = KS.importSet(m, { format: KS.FORMAT, version: 1, keys: [{ path: ['PACS', 'Nope'], keys: '^!z' }] });
  assert.strictEqual(r.matched, 0);
  assert.deepStrictEqual(r.unmatched, ['PACS > Nope']);
  assert.strictEqual(KS.importSet(m, { hello: 1 }).ok, false);
});

test('change, clear, reset, duplicates, cheat sheet', () => {
  const m = menu();
  const soft = KS.keyItems(m)[0];
  KS.setKeys(soft.item, 'w');
  assert.strictEqual(KS.keyItems(m)[0].keys, 'w');
  KS.setKeys(KS.keyItems(m)[1].item, 'W');
  assert.strictEqual(KS.duplicates(m).length, 1, 'two directions pressing W');
  assert.ok(KS.clearAll(m) > 0);
  assert.ok(KS.keyItems(m).every((k) => k.keys === ''));
  assert.ok(validateMenu(m).ok, 'a cleared menu is still valid');
  assert.ok(KS.resetToDefaults(m, menu()) > 0);
  assert.deepStrictEqual(norm(KS.keyItems(m).map((k) => k.keys)), norm(KS.keyItems(menu()).map((k) => k.keys)));
  const sheet = KS.cheatSheet(m);
  assert.match(sheet, /PACS > Window \/ level\r\n  Soft tissue: Ctrl\+Alt\+1/);
});

test('recorder: single keys only where the ring presses them', () => {
  const ev = (o) => ({ code: 'KeyW', key: 'w', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  assert.strictEqual(HK.fromEvent(ev()), '', 'a RadGesture shortcut needs a modifier');
  assert.strictEqual(HK.fromEvent(ev(), { plain: true }), 'w', 'a key for Sectra may be single');
  assert.strictEqual(HK.fromEvent(ev({ ctrlKey: true, altKey: true })), '^!w');
  assert.deepStrictEqual(HK.heldMods(ev({ ctrlKey: true, shiftKey: true })), ['Ctrl', 'Shift']);
});
