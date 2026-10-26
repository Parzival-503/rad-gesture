const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const R = require('../src/common/reflib');
const { validateMenu } = require('../src/common/menu');

const link = (n) => ({ name: n, icon: 'menu_book', action: 'url:https://example.org/' + n });
const shipped = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default-menu.json'), 'utf8')).categories.find((c) => c.id === 'gallery');

test('the shipped Reference Library reads as its four sections plus its tools', () => {
  const lib = R.read(shipped());
  assert.deepStrictEqual(lib.sections.map((s) => s.name), ['CT Chest', 'Abdomen', 'Ultrasound', 'PET-CT']);
  assert.deepStrictEqual(lib.tools.map((t) => t.name), ['Search copied text', 'My documents', 'Add from clipboard']);
  assert.strictEqual(lib.loose.length, 0);
});

test('read then pack gives the same ring back', () => {
  const ring = shipped();
  const before = JSON.stringify(ring.items);
  R.pack(ring, R.read(ring));
  assert.strictEqual(JSON.stringify(ring.items), before);
  assert.strictEqual(ring.emptySections, undefined);
});

test('more sections than fit roll into "More sections", and read back in order', () => {
  const ring = shipped();
  const lib = R.read(ring);
  for (let i = 1; i <= 6; i++) lib.sections.push({ name: 'Extra ' + i, icon: 'folder', items: [link('x' + i)] });
  R.pack(ring, lib);
  assert.ok(ring.items.length <= R.MAX);
  const more = ring.items.find((i) => i.more);
  assert.ok(more && more.name === 'More sections');
  assert.deepStrictEqual(R.read(ring).sections.map((s) => s.name), lib.sections.map((s) => s.name));
  assert.ok(validateMenu({ categories: [ring] }).ok, validateMenu({ categories: [ring] }).errors.join('; '));
});

test('a section with more than 8 entries rolls the rest into "More"', () => {
  const ring = shipped();
  const lib = R.read(ring);
  lib.sections[0].items = Array.from({ length: 20 }, (_, i) => link('n' + i));
  R.pack(ring, lib);
  const s = ring.items[0];
  assert.strictEqual(s.items.length, 8);
  assert.ok(s.items[7].more);
  const back = R.read(ring).sections[0].items.map((x) => x.name);
  assert.deepStrictEqual(back, lib.sections[0].items.map((x) => x.name));
  assert.ok(validateMenu({ categories: [ring] }).ok);
});

test('an empty section is kept off the ring, in its place in the list', () => {
  const ring = shipped();
  const lib = R.read(ring);
  lib.sections.splice(1, 0, { name: 'Neuro', icon: 'neurology', items: [] });
  R.pack(ring, lib);
  assert.ok(!ring.items.some((i) => i.name === 'Neuro'), 'not on the ring');
  assert.ok(validateMenu({ categories: [ring] }).ok, 'the ring is still valid');
  assert.deepStrictEqual(R.read(ring).sections.map((s) => s.name), ['CT Chest', 'Neuro', 'Abdomen', 'Ultrasound', 'PET-CT']);
  // Something added: it becomes a real smaller ring, in that place.
  const again = R.read(ring);
  again.sections[1].items.push(link('stroke'));
  R.pack(ring, again);
  assert.strictEqual(ring.items[1].name, 'Neuro');
  assert.strictEqual(ring.emptySections, undefined);
});

test('a link sitting directly on the ring stays there', () => {
  const ring = shipped();
  ring.items.splice(0, 0, link('direct'));
  const lib = R.read(ring);
  assert.deepStrictEqual(lib.loose.map((l) => l.name), ['direct']);
  R.pack(ring, lib);
  assert.ok(ring.items.some((i) => i.name === 'direct'));
});
