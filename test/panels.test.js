const test = require('node:test');
const assert = require('node:assert');
const { clean, ACTION } = require('../src/main/panels');

test('the helper\'s windows take only what they show, trimmed', () => {
  const tb = clean('toolbar', { visible: 1, priors: [{ peek: 'x'.repeat(500) }, null], chart: 'nope', extra: 1 });
  assert.deepStrictEqual(Object.keys(tb), ['visible', 'priors', 'chart']);
  assert.strictEqual(tb.priors[0].peek.length, 140);
  assert.deepStrictEqual(tb.chart, []);
  const c = clean('card', { title: 'Impression', text: 'a', copy: 'b', checks: 1, buttons: [{ id: 'imp:insert', label: 'Insert', primary: 1 }, { id: '', label: 'no id' }, { label: 'no id either' }] });
  assert.strictEqual(c.checks, true);
  assert.strictEqual(c.copy, 'b');
  assert.deepStrictEqual(c.buttons.map((b) => b.id), ['imp:insert']);
  const t = clean('toast', { text: 'hi', kind: 'weird', ms: 999999 });
  assert.deepStrictEqual(t, { text: 'hi', kind: 'info', ms: 60000 });
});

test('a panel button can only ask the helper for its own kinds of action', () => {
  for (const ok of ['prior:add', 'prior:remove:2', 'chart:clear', 'chart:keep', 'impression', 'oneliner', 'toolbar:hide', 'imp:insert', 'priorlist:insert', 'pick:oncologic', 'pick:cancel'])
    assert.ok(ACTION.test(ok), ok);
  for (const bad of ['keys:^c', 'lib:LoginUandP', 'run:start|c:\\x.exe|', 'reload', 'prior:add|x', 'Prior:add', 'oe:clip'])
    assert.ok(!ACTION.test(bad), bad);
});
