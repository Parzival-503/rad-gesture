// The Reference Library: notes and pictures, the formatter, the ring action.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MD = require('../src/common/markdown');
const { createReferences } = require('../src/main/references');
const { validateMenu, parseAction } = require('../src/common/menu');
const { resolveAction } = require('../src/main/actions');

test('notes: headings, emphasis, lists, check lists, tables, quotes, code, links', () => {
  const html = MD.render([
    '# Fleischner 2017', '## Solid nodules', '### Single', '#### Low risk',
    '**bold** *italic* _also_ ~~old~~ ==key== `code`',
    'line one', 'line two', '',
    '- a', '  - nested', '- b', '1. one', '2. two', '- [ ] todo', '- [x] done', '',
    '| Size | Follow-up |', '|---|:---:|', '| < 6 mm | None |', '',
    '> **Pearl** perifissural nodes', '', '```', 'x <b>', '```', '---',
    '[Radiopaedia](https://radiopaedia.org) and https://example.org/a?b=1',
  ].join('\n'));
  for (const bit of ['<h1>Fleischner 2017</h1>', '<h2>Solid nodules</h2>', '<h3>Single</h3>', '<h4>Low risk</h4>', '<strong>bold</strong>',
    '<em>italic</em>', '<em>also</em>', '<del>old</del>', '<mark>key</mark>', '<code>code</code>', 'line one<br>line two',
    '<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>', '<ol><li>one</li><li>two</li></ol>', 'class="todo"', 'class="done"',
    '<th>Size</th>', '<th style="text-align:center">Follow-up</th>', '<td>&lt; 6 mm</td>', '<blockquote class="callout pearl">',
    '<pre><code>x &lt;b&gt;</code></pre>', '<hr>', '<a href="https://radiopaedia.org">Radiopaedia</a>', '<a href="https://example.org/a?b=1">']) {
    assert.ok(html.includes(bit), bit);
  }
});

test('notes can never carry HTML or script', () => {
  const html = MD.render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](file:///c:/x) <script>alert(1)</script>\n# <b>t</b>');
  assert.ok(!/<img|<script|<b>|javascript:|file:/i.test(html), html);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a note\'s title is its first heading or line', () => {
  assert.strictEqual(MD.titleOf('\n# **Bosniak** 2019\ntext'), 'Bosniak 2019');
  assert.strictEqual(MD.titleOf('LI-RADS cheat sheet\nmore'), 'LI-RADS cheat sheet');
});

test('references: create, update, picture, list newest first, delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-refs-'));
  const refs = createReferences({ dir: () => dir });
  const a = refs.save({ title: 'TI-RADS', tags: 'Thyroid, US, thyroid', body: '# TI-RADS\n\n- TR5: FNA at 1 cm' });
  assert.match(a.id, /^r[a-z0-9]+$/);
  assert.deepStrictEqual(a.tags, ['thyroid', 'us']);
  assert.strictEqual(fs.readFileSync(path.join(dir, a.id + '.md'), 'utf8'), '# TI-RADS\n\n- TR5: FNA at 1 cm');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const b = refs.save({ png });
  assert.strictEqual(b.image, b.id + '.png');
  assert.match(b.title, /^Screenshot /);
  assert.ok(fs.existsSync(refs.imagePath(b.id)));
  refs.save({ id: a.id, title: 'ACR TI-RADS' });
  const list = refs.list();
  assert.deepStrictEqual(list.map((r) => r.id), [a.id, b.id], 'last changed first');
  assert.strictEqual(list[0].title, 'ACR TI-RADS');
  assert.strictEqual(list[0].body, '# TI-RADS\n\n- TR5: FNA at 1 cm', 'the note kept');
  assert.strictEqual(refs.get('../evil'), null);
  assert.ok(refs.remove(b.id));
  assert.ok(!fs.existsSync(path.join(dir, b.id + '.png')));
  assert.deepStrictEqual(refs.list().map((r) => r.id), [a.id]);
});

test('ring: "ref:<id>" opens a reference; the Reference Library ring can add from the clipboard', () => {
  assert.deepStrictEqual(parseAction('ref:rabc123'), { kind: 'ref', value: 'rabc123' });
  assert.strictEqual(resolveAction('ref:rabc123').kind, 'ref');
  const menu = { categories: [{ name: 'R', items: [{ name: 'Note', icon: 'description', action: 'ref:rabc123' }] }] };
  assert.ok(validateMenu(menu).ok);
  const def = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default-menu.json'), 'utf8'));
  const ring = def.categories.find((c) => c.id === 'gallery');
  assert.strictEqual(ring.name, 'Reference Library');
  assert.ok(ring.items.some((it) => it.action === 'hub:ref-add'));
});

test('references: a file is copied in, opens from the copy, and goes when deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-refs-file-'));
  const src = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rg-src-')), 'Fleischner 2017.PDF');
  fs.writeFileSync(src, '%PDF-1.4 invented test file');
  const refs = createReferences({ dir: () => dir });
  const f = refs.addFile(src);
  assert.strictEqual(f.title, 'Fleischner 2017');
  assert.strictEqual(f.fileName, 'Fleischner 2017.PDF');
  assert.strictEqual(f.file, f.id + '.pdf');
  fs.rmSync(src);
  assert.strictEqual(fs.readFileSync(refs.filePath(f.id), 'utf8'), '%PDF-1.4 invented test file', 'still there after the original went');
  assert.ok(refs.remove(f.id));
  assert.ok(!fs.existsSync(path.join(dir, f.file)));
});
