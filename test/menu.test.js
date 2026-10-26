const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { validateMenu, categoryForApp, parseAction } = require('../src/common/menu');
const { RGIcons } = require('../src/renderer/icons'); // the file sets RGIcons on its 'this'

const root = path.join(__dirname, '..');
const menu = JSON.parse(fs.readFileSync(path.join(root, 'config/default-menu.json'), 'utf8'));

function walk(items, fn) {
  for (const it of items) {
    fn(it);
    if (it.items) walk(it.items, fn);
  }
}

test('the default menu is valid', () => {
  assert.deepStrictEqual(validateMenu(menu), { ok: true, errors: [] });
});

test('bad menus are explained, not crashed on', () => {
  assert.strictEqual(validateMenu({}).ok, false);
  const r = validateMenu({ categories: [{ name: 'X', items: [{ name: 'A', action: 'ftp:x' }, { name: 'B' }] }] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 2);
  const tooMany = { categories: [{ name: 'X', items: Array.from({ length: 9 }, (_, i) => ({ name: 'i' + i, action: 'hub:x' })) }] };
  assert.match(validateMenu(tooMany).errors[0], /the most is 8/);
});

test('PowerScribe opens the AI ring first, anything else the first ring (PACS)', () => {
  assert.strictEqual(categoryForApp(menu, 'nuance.powerscribe360.exe'), 1);
  assert.strictEqual(categoryForApp(menu, 'chrome.exe'), 0);
  const m = { categories: [{ name: 'A', items: [] }, { name: 'B', apps: ['Epic.exe'], items: [] }] };
  assert.strictEqual(categoryForApp(m, 'epic.exe'), 1);
});

test('every icon in the default menu exists in the bundled icon font', () => {
  const symbols = new Set(JSON.parse(fs.readFileSync(path.join(root, 'assets/fonts/material-symbols-names.json'), 'utf8')));
  const tabler = require(path.join(root, 'assets/fonts/tabler-map.js'));
  const names = { has: (n) => {
    const r = RGIcons.resolve(n);
    if (r.kind === 'tabler') return !!tabler[r.value];
    return ['text', 'grid'].includes(r.kind) || symbols.has(r.value);
  } };
  for (const c of menu.categories) {
    assert.ok(names.has(c.icon), `category icon ${c.icon}`);
    walk(c.items, (it) => assert.ok(names.has(it.icon), `icon "${it.icon}" for ${it.name}`));
  }
});

test('every helper action in the menu is handled by the AutoHotkey helper', () => {
  const ahk = fs.readFileSync(path.join(root, 'helper/RadGestureHelper.ahk'), 'utf8');
  const body = ahk.slice(ahk.indexOf('RunHubAction(a) {'));
  const handled = (id) =>
    body.includes(`(a = "${id}")`) ||
    (id.startsWith('oneliner:') && body.includes('(SubStr(a, 1, 9) = "oneliner:")')) ||
    (id.startsWith('keys:') && body.includes('(SubStr(a, 1, 5) = "keys:")')) ||
    (id.startsWith('lib:') && body.includes('(SubStr(a, 1, 4) = "lib:")')); // ids: test/library.test.js
  for (const c of menu.categories) {
    walk(c.items, (it) => {
      const a = it.action && parseAction(it.action);
      if (a && a.kind === 'helper') assert.ok(handled(a.value), `helper action "${a.value}" has no handler in RunHubAction`);
    });
  }
  // The one-liner flavors must be ones the helper's prompts know.
  for (const f of ['full', 'oncologic', 'treatment', 'indication']) assert.ok(ahk.includes(`(flavor = "${f}")`), f);
});

test('every suggested Tabler icon exists in the bundled font', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'settings', 'settings.js'), 'utf8');
  const names = (src.match(/const SUGGESTED_TABLER = \[([^\]]+)\]/) || [])[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const map = require('../assets/fonts/tabler-map.js');
  assert.deepStrictEqual(names.filter((n) => !map[n]), []);
});
