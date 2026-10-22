const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createSupervisor } = require('../src/main/helper-supervisor');

function fakeChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = () => {};
  return c;
}

test('restarting: the replaced helper reporting in late is not a crash of the new one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-sup-'));
  fs.writeFileSync(path.join(dir, 'RadGestureHelper.exe'), '');
  const spawned = [];
  let strays = 0;
  const sup = createSupervisor({
    resourcesDir: dir, platform: 'win32', killStrays: () => strays++,
    spawnImpl: () => { const c = fakeChild(100 + spawned.length); spawned.push(c); return c; },
  });
  sup.start();
  sup.restart();
  assert.strictEqual(spawned.length, 2);
  assert.strictEqual(strays, 2, 'stray helpers are cleared before each start');
  spawned[0].emit('exit', 1); // the killed one, late
  const s = sup.status();
  assert.strictEqual(s.running, true, 'the new helper is still the one being watched');
  assert.strictEqual(s.pid, 101);
  assert.strictEqual(s.lastError, '');
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(spawned.length, 2, 'and no extra restart was set off');
  // A real exit of the current one is still restarted.
  spawned[1].emit('exit', 0);
  assert.match(sup.status().lastError, /exit code 0/);
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(spawned.length, 3);
  sup.stop();
});
