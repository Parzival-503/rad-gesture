const test = require('node:test');
const assert = require('node:assert');
const { createBridge } = require('../src/main/bridge');

async function call(port, method, p, token = 't0k') {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'X-RG-Token': token } });
  return { status: r.status, text: await r.text() };
}

test('bridge: token, show, release, poll queue, cancel', async () => {
  let open = false;
  let shownFor = null;
  const b = createBridge({
    token: 't0k',
    onShow: (exe) => { open = true; shownFor = exe; },
    onRelease: async () => { open = false; return 'action:proofread'; },
    onCancel: () => { open = false; },
    isOpen: () => open,
  });
  const port = await b.listen(47900);
  try {
    assert.strictEqual((await call(port, 'POST', '/show', 'wrong')).status, 403);
    assert.strictEqual((await call(port, 'POST', '/show?app=Nuance.PowerScribe360.exe')).text, 'ok');
    assert.strictEqual(shownFor, 'Nuance.PowerScribe360.exe');
    assert.strictEqual((await call(port, 'GET', '/poll')).text, 'open');
    assert.strictEqual((await call(port, 'POST', '/release')).text, 'action:proofread');
    assert.strictEqual((await call(port, 'GET', '/poll')).text, 'closed');
    b.enqueue('settings');
    assert.strictEqual((await call(port, 'GET', '/poll')).text, 'action:settings');
    assert.strictEqual((await call(port, 'GET', '/poll')).text, 'closed');
    await call(port, 'POST', '/show');
    await call(port, 'POST', '/cancel');
    assert.strictEqual(open, false);
  } finally {
    await b.close();
  }
});

test('bridge moves to the next port if the first is taken', async () => {
  const a = createBridge({ token: 'x', onShow() {}, onRelease: async () => 'none', onCancel() {}, isOpen: () => false });
  const b = createBridge({ token: 'x', onShow() {}, onRelease: async () => 'none', onCancel() {}, isOpen: () => false });
  const pa = await a.listen(47920);
  const pb = await b.listen(47920);
  assert.strictEqual(pb, pa + 1);
  await a.close();
  await b.close();
});

test('bridge: Setup can ask the app to quit (POST, token required)', async () => {
  let quits = 0;
  const b = createBridge({ token: 't0k', onShow() {}, onRelease: async () => 'none', onCancel() {}, isOpen: () => false, onQuit: () => { quits++; } });
  const port = await b.listen(47940);
  try {
    assert.strictEqual((await call(port, 'POST', '/quit', 'wrong')).status, 403);
    assert.strictEqual((await call(port, 'GET', '/quit')).status, 405);
    assert.strictEqual(quits, 0);
    assert.strictEqual((await call(port, 'POST', '/quit')).text, 'bye');
    assert.strictEqual(quits, 1);
  } finally {
    await b.close();
  }
});

test('bridge: the helper can open Settings on a page', async () => {
  let tab = null;
  const b = createBridge({ token: 't0k', onShow() {}, onRelease: async () => 'none', onCancel() {}, isOpen: () => false, onOpenSettings: (t) => { tab = t; } });
  const port = await b.listen(47950);
  try {
    assert.strictEqual((await call(port, 'POST', '/open-settings?tab=ai')).text, 'ok');
    assert.strictEqual(tab, 'ai');
  } finally {
    await b.close();
  }
});
