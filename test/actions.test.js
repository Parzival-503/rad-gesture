const test = require('node:test');
const assert = require('node:assert');
const { resolveAction } = require('../src/main/actions');

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
