const test = require('node:test');
const assert = require('node:assert');
const { resolveAction } = require('../src/main/actions');
const fs = require('fs');
const path = require('path');

test('helper and url actions pass through', () => {
  assert.deepStrictEqual(resolveAction('helper:oneliner:full'), { kind: 'helper', value: 'oneliner:full' });
  assert.deepStrictEqual(resolveAction('url:https://x.org/a?b=1'), { kind: 'url', value: 'https://x.org/a?b=1' });
});

test('file paths expand %VARS% case-insensitively', () => {
  const r = resolveAction('file:%USERPROFILE%\\Documents', { env: { UserProfile: 'C:\\Users\\sina' } });
  assert.deepStrictEqual(r, { kind: 'file', value: 'C:\\Users\\sina\\Documents' });
});

test('search fills copied text, trimmed and capped', () => {
  const r = resolveAction('search:https://radiopaedia.org/search?q={clipboard}', { clipboard: '  renal\n  angiomyolipoma ' });
  assert.strictEqual(r.value, 'https://radiopaedia.org/search?q=renal%20angiomyolipoma');
  const long = resolveAction('search:q={clipboard}', { clipboard: 'a'.repeat(1000) });
  assert.strictEqual(long.value.length, 2 + 300);
});

test('nonsense is reported, not run', () => {
  assert.strictEqual(resolveAction('rm -rf').kind, 'invalid');
});

test('Open a program: the instruction the helper gets', () => {
  const { runSpec, resolveAction } = require('../src/main/actions');
  const env = { USERPROFILE: 'C:\\Users\\me' };
  assert.strictEqual(runSpec({ action: 'app:%USERPROFILE%\\MyTimer.ahk' }, null, env), 'run:front|C:\\Users\\me\\MyTimer.ahk|');
  assert.strictEqual(runSpec({ action: 'app:C:\\Epic\\epic.exe', args: '-x\r\n-y', ifRunning: 'new' }, null, env), 'run:new|C:\\Epic\\epic.exe|-x -y');
  assert.strictEqual(runSpec({ action: 'app:notepad.exe' }, 'start', env), 'run:start|notepad.exe|');
  assert.deepStrictEqual(resolveAction('app:%USERPROFILE%\\a.exe', { env }), { kind: 'app', value: 'C:\\Users\\me\\a.exe' });
});

test('picture icons: imported, listed, used by a menu, handed out as data URLs', () => {
  const os = require('os');
  const { createIconStore } = require('../src/main/icon-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-icons-'));
  const store = createIconStore({ dir: () => path.join(dir, 'icons') });
  const svg = path.join(dir, 'pic.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const r = store.importFile(svg);
  assert.ok(r.ok && r.file.endsWith('.svg'));
  assert.deepStrictEqual(store.list(), [r.file]);
  assert.match(store.dataUrls()[r.file], /^data:image\/svg\+xml;base64,/);
  const menu = { categories: [{ name: 'A', icon: 'img:' + r.file, items: [{ name: 'x', icon: 'ti:lungs', action: 'url:https://a' }] }] };
  assert.deepStrictEqual(store.usedBy(menu), [r.file]);
  assert.strictEqual(store.importFile(path.join(dir, 'notes.txt')).ok, false);
});
