// Starts the real hub (Electron) with a throwaway settings folder and drives
// it over the bridge exactly as the AutoHotkey helper would.
//   xvfb-run -a node scripts/smoke.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-smoke-'));
const electron = require('electron'); // path to the binary
const app = spawn(electron, ['.', '--no-sandbox'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, RG_USER_DATA: dir, RG_SMOKE: dir },
});
let out = '';
app.stdout.on('data', (d) => (out += d));
app.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(port, token, method, p) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'X-RG-Token': token } });
  return r.text();
}

(async () => {
  let ini = '';
  for (let i = 0; i < 100 && !ini; i++) {
    await sleep(200);
    const f = path.join(dir, 'bridge.ini');
    if (fs.existsSync(f)) ini = fs.readFileSync(f, 'utf8');
  }
  assert.ok(ini, 'hub wrote bridge.ini');
  const port = +ini.match(/Port=(\d+)/)[1];
  const token = ini.match(/Token=(\w+)/)[1];
  assert.ok(fs.existsSync(path.join(dir, 'menu.json')), 'hub created menu.json from the default');

  assert.strictEqual(await call(port, token, 'GET', '/ping'), 'radgesture');
  assert.strictEqual(await call(port, token, 'POST', '/show?app=Nuance.PowerScribe360.exe'), 'ok');
  assert.strictEqual(await call(port, token, 'GET', '/poll'), 'open');
  for (let i = 0; i < 40 && !/SMOKE captured/.test(out); i++) await sleep(250);
  assert.match(out, /SMOKE ring \{"levels":1,"cat":0,"items":5,"drawn":5,"center":1\d\d\} visible=true focusable=false/);
  // Released with nothing aimed at, after the tap window: closes, runs nothing.
  assert.strictEqual(await call(port, token, 'POST', '/release'), 'none');
  assert.strictEqual(await call(port, token, 'GET', '/poll'), 'closed');
  // A quick tap keeps it open for clicking; Esc (cancel) closes it.
  await sleep(1500); // let the first report finish
  await call(port, token, 'POST', '/show');
  assert.strictEqual(await call(port, token, 'POST', '/release'), 'stay');
  assert.strictEqual(await call(port, token, 'GET', '/poll'), 'open');
  await call(port, token, 'POST', '/cancel');
  assert.strictEqual(await call(port, token, 'GET', '/poll'), 'closed');
  await sleep(1200); // let the tap's own report go by
  // A broken menu.json keeps the last good menu.
  fs.writeFileSync(path.join(dir, 'menu.json'), '{ not json');
  await sleep(800);
  assert.strictEqual(await call(port, token, 'POST', '/show'), 'ok');
  const rings = () => (out.match(/SMOKE ring .*/g) || []);
  const before = rings().length;
  for (let i = 0; i < 40 && rings().length === before; i++) await sleep(250);
  assert.match(rings().pop(), /"items":5,"drawn":5.*visible=true/);
  await call(port, token, 'POST', '/cancel');

  const png = path.join(dir, 'overlay.png');
  if (fs.existsSync(png)) fs.copyFileSync(png, path.join(__dirname, 'shots', 'smoke-overlay.png'));
  console.log('PASS smoke: hub starts, bridge works, ring opens without focus, bad menu tolerated');
  app.kill();
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message, '\n--- app output ---\n' + out);
  app.kill();
  process.exit(1);
});
