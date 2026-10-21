const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/common/themes');

test('every theme is dark and complete', () => {
  const ringKeys = Object.keys(T.get('graphite').ring);
  const uiKeys = Object.keys(T.get('graphite').ui);
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  for (const t of T.THEMES) {
    assert.deepStrictEqual(Object.keys(t.ring), ringKeys, `${t.id} ring variables`);
    assert.deepStrictEqual(Object.keys(t.ui), uiKeys, `${t.id} Settings variables`);
    assert.ok(lum(t.ui.bg) < 0.1 && lum(t.ui.card) < 0.16, `${t.id} is a dark theme (no light themes, reading rooms are dark)`);
    assert.ok(['fill', 'outline'].includes(t.lit));
    assert.ok(t.palette === null || t.palette.length >= 6);
  }
});

test('ring colours: the theme palette, unless the person keeps their own', () => {
  const menu = { theme: 'synthwave', categories: [{ color: '#111111' }, { color: '#222222' }] };
  assert.strictEqual(T.ringColor(menu, 1), T.get('synthwave').palette[1]);
  assert.strictEqual(T.ringColor({ ...menu, ringColors: 'mine' }, 1), '#222222');
  assert.strictEqual(T.ringColor({ ...menu, theme: 'graphite' }, 0), '#111111', 'Graphite always keeps their colours');
  assert.strictEqual(T.ringColor({ ...menu, theme: 'gone' }, 0), '#111111', 'an unknown theme falls back to Graphite');
  assert.deepStrictEqual(T.cssVars('grid', 'ui').find(([k]) => k === '--ink-2'), ['--ink-2', T.get('grid').ui.ink2]);
});
