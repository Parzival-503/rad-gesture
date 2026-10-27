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

test('a topic holds several sources, and survives read and pack', () => {
  const ring = shipped();
  const lib = R.read(ring);
  const abd = lib.sections[1];
  const pdf = { name: 'LI-RADS article', icon: 'picture_as_pdf', action: 'ref:rabcdef' };
  const pic = { name: 'LI-RADS table', icon: 'image', action: 'ref:rghijkl' };
  abd.items.splice(0, 1, { name: 'LI-RADS', icon: 'topic', topic: true, items: [abd.items[0], pdf, pic] });
  R.pack(ring, lib);
  assert.ok(validateMenu({ categories: [ring] }).ok);
  const t = R.read(ring).sections[1].items[0];
  assert.ok(t.topic);
  assert.deepStrictEqual(t.items.map((x) => x.name), ['LI-RADS v2018', 'LI-RADS article', 'LI-RADS table']);
});

test('an empty topic waits off the ring, in its place inside its section', () => {
  const ring = shipped();
  const lib = R.read(ring);
  lib.sections[0].items.splice(1, 0, { name: 'Nodules', icon: 'topic', topic: true, items: [] });
  R.pack(ring, lib);
  assert.ok(validateMenu({ categories: [ring] }).ok);
  assert.ok(!ring.items[0].items.some((i) => i.name === 'Nodules'));
  const back = R.read(ring).sections[0].items;
  assert.deepStrictEqual(back.map((x) => x.name), ['Lung-RADS v2022', 'Nodules', 'Fleischner 2017']);
  assert.ok(back[1].topic);
});

test('a topic with more than 8 sources rolls the rest into "More"', () => {
  const ring = shipped();
  const lib = R.read(ring);
  lib.sections[0].items.push({ name: 'Big', icon: 'topic', topic: true, items: Array.from({ length: 11 }, (_, i) => link('b' + i)) });
  R.pack(ring, lib);
  assert.ok(validateMenu({ categories: [ring] }).ok);
  assert.strictEqual(R.read(ring).sections[0].items.find((x) => x.topic).items.length, 11);
});

const names = (list) => list.map((x) => x.name);

test('move: sections reorder; a section goes before another or last', () => {
  const lib = R.read(shipped());
  assert.deepStrictEqual(R.move(lib, { sec: 3 }, { sec: 0 }), { sec: 0 });
  assert.deepStrictEqual(names(lib.sections), ['PET-CT', 'CT Chest', 'Abdomen', 'Ultrasound']);
  assert.deepStrictEqual(R.move(lib, { sec: 0 }, { end: true }), { sec: 3 });
  assert.deepStrictEqual(names(lib.sections), ['CT Chest', 'Abdomen', 'Ultrasound', 'PET-CT']);
  assert.strictEqual(R.move(lib, { sec: 0 }, { sec: 1, idx: 0 }), null, 'a section never goes inside a section');
});

test('move: an entry reorders in its section, and moves to another section', () => {
  const lib = R.read(shipped());
  const chest = names(lib.sections[0].items);
  assert.deepStrictEqual(R.move(lib, { sec: 0, idx: 1 }, { sec: 0, idx: 0 }), { sec: 0, idx: 0 });
  assert.deepStrictEqual(names(lib.sections[0].items), [chest[1], chest[0], ...chest.slice(2)]);
  const moved = lib.sections[0].items[0].name;
  const at = R.move(lib, { sec: 0, idx: 0 }, { sec: 1 }); // the end of Abdomen
  assert.strictEqual(lib.sections[1].items[at.idx].name, moved);
  assert.ok(!names(lib.sections[0].items).includes(moved));
  // Before an entry of another section.
  R.move(lib, { sec: 1, idx: at.idx }, { sec: 2, idx: 0 });
  assert.strictEqual(lib.sections[2].items[0].name, moved);
});

test('move: into and out of a topic, and within it; never a topic into a topic', () => {
  const lib = R.read(shipped());
  const abd = lib.sections[1];
  abd.items.splice(0, 1, { name: 'LI-RADS', icon: 'topic', topic: true, items: [abd.items[0]] });
  const loose = abd.items[2].name;
  // A section entry dropped on the topic: last in it (the topic shifts up when the entry was before it).
  let at = R.move(lib, { sec: 1, idx: 2 }, { sec: 1, idx: 0, end: true });
  assert.deepStrictEqual(at, { sec: 1, idx: 0, sub: 1 });
  assert.strictEqual(abd.items[0].items[1].name, loose);
  // Reorder inside the topic.
  at = R.move(lib, { sec: 1, idx: 0, sub: 1 }, { sec: 1, idx: 0, sub: 0 });
  assert.deepStrictEqual(names(abd.items[0].items)[0], loose);
  // Out of the topic, before the first entry of CT Chest.
  at = R.move(lib, { sec: 1, idx: 0, sub: 0 }, { sec: 0, idx: 0 });
  assert.strictEqual(lib.sections[0].items[0].name, loose);
  // An entry from earlier in the same section into a topic later in it.
  abd.items.push({ name: 'Pancreas', icon: 'topic', topic: true, items: [] });
  const fi = abd.items.findIndex((x) => !x.topic);
  const first = abd.items[fi].name;
  at = R.move(lib, { sec: 1, idx: fi }, { sec: 1, idx: abd.items.length - 1, end: true });
  assert.strictEqual(abd.items[at.idx].name, 'Pancreas');
  assert.deepStrictEqual(names(abd.items[at.idx].items), [first]);
  assert.strictEqual(R.move(lib, { sec: 1, idx: abd.items.findIndex((x) => x.topic) }, { sec: 1, idx: at.idx, end: true }), null);
});

test('move: tools reorder among themselves; the ring keeps the new order', () => {
  const ring = shipped();
  const lib = R.read(ring);
  assert.deepStrictEqual(R.move(lib, { tool: 2 }, { tool: 0 }), { tool: 0 });
  assert.deepStrictEqual(names(lib.tools), ['Add from clipboard', 'Search copied text', 'My documents']);
  assert.strictEqual(R.move(lib, { tool: 0 }, { sec: 0 }), null);
  R.pack(ring, lib);
  assert.deepStrictEqual(names(R.read(ring).tools), ['Add from clipboard', 'Search copied text', 'My documents']);
  assert.ok(validateMenu({ categories: [ring] }).ok);
});
