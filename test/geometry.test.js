const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/renderer/geometry');

test('angles: 0 is up, clockwise', () => {
  assert.strictEqual(G.angleOf(0, -1), 0);
  assert.strictEqual(G.angleOf(1, 0), 90);
  assert.strictEqual(G.angleOf(0, 1), 180);
  assert.strictEqual(G.angleOf(-1, 0), 270);
  assert.strictEqual(G.angDiff(350, 10), 20);
});

test('root ring starts at the top and spreads evenly', () => {
  assert.deepStrictEqual(G.slotAngles(4).items, [0, 90, 180, 270]);
});

test('sub-ring keeps the way back where you came from', () => {
  const s = G.slotAngles(3, 180);
  assert.strictEqual(s.back, 180);
  assert.deepStrictEqual(s.items, [270, 0, 90]);
});

test('aim follows direction, not distance; dead zone aims at nothing', () => {
  const s = G.slotAngles(4);
  assert.strictEqual(G.aimAt(s, 5, 5, 30), -1);
  assert.strictEqual(G.aimAt(s, 200, 10, 30), 1);
  assert.strictEqual(G.aimAt(s, -40, -3, 30), 3);
  const sub = G.slotAngles(2, 180);
  assert.strictEqual(G.aimAt(sub, 0, 80, 30), 'back');
});

test('the ring is kept on screen', () => {
  assert.deepStrictEqual(G.clampCenter(5, 900, 1000, 1000, 170), { x: 170, y: 830 });
});
