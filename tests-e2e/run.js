// End-to-end test of the real app (Electron), driven by Playwright.
//
//   Linux (cloud):   xvfb-run -a node tests-e2e/run.js
//   Windows (CI):    RG_APP_EXE=dist\win-unpacked\RadGesture.exe AHK_EXE=...\AutoHotkeyU64.exe node tests-e2e\run.js
//
// Always: tray menu items work, the Settings window opens on every page and
// saves to the files the helper reads, the ring opens and switches rings.
// On Windows with the bundled helper: the helper starts and checks in, and a
// real Ctrl+CapsLock (injected) opens the ring; a flick and a tap-then-click
// both reach the helper, which confirms it ran the action.

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
let pw;
try { pw = require('playwright'); } catch (_) { pw = require('/opt/node-tools/node_modules/playwright'); }
const { _electron: electron } = pw;

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'e2e-shots');
const WIN = process.platform === 'win32';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
}

async function waitFor(fn, ms, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (_) {}
    await sleep(step);
  }
  return null;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-e2e-'));
  // A test ring first (keys nobody uses), then the real default rings.
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-menu.json'), 'utf8'));
  menu.startAtLogin = false;
  menu.categories.unshift({
    id: 'e2e', name: 'E2E', color: '#8fb0ff', icon: 'science',
    items: [
      { name: 'Up: F13', icon: 'north', action: 'helper:keys:{F13}' },
      { name: 'Down: F14', icon: 'south', action: 'helper:keys:{F14}' },
    ],
  });
  fs.writeFileSync(path.join(userData, 'menu.json'), JSON.stringify(menu, null, 2));
  fs.writeFileSync(path.join(userData, 'welcomed'), 'e2e');

  const env = { ...process.env, RG_E2E: '1', RG_USER_DATA: userData };
  if (!WIN) env.RG_NO_HELPER = '1';
  const launch = process.env.RG_APP_EXE
    ? { executablePath: process.env.RG_APP_EXE, args: [], env }
    : { executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env };
  const app = await electron.launch(launch);
  app.process().stdout.on('data', (d) => process.stdout.write('  [app] ' + d));

  const rg = (fn, arg) => app.evaluate(({}, [src, a]) => {
    // eslint-disable-next-line no-new-func
    return new Function('rg', 'a', 'return (' + src + ')(rg, a)')(global.__rg, a);
  }, [fn.toString(), arg]);

  try {
    check('hub started', await waitFor(() => app.evaluate(() => !!global.__rg), 20000));

    // ---------------- tray
    const labels = await rg((r) => r.trayLabels());
    for (const l of ['Open the ring', 'Settings...', 'Edit rings...', 'AI tools...', 'Shortcuts...', 'Pause the ring', 'Start with Windows', 'Status and help...', 'Quit RadGesture']) {
      check(`tray has "${l}"`, labels.includes(l));
    }

    // ---------------- settings window, every page
    await rg((r) => r.clickTray('Settings...'));
    const win = await waitFor(async () => app.windows().find((w) => w.url().includes('settings')), 15000);
    check('tray > Settings... opens the Settings window', !!win);
    await win.waitForFunction(() => window.__settingsReady === true, null, { timeout: 15000 });
    await win.setViewportSize({ width: 1200, height: 780 }).catch(() => {});
    for (const tab of ['rings', 'ai', 'shortcuts', 'general', 'status']) {
      await win.click(`#nav button[data-tab="${tab}"]`);
      await sleep(350);
      const h1 = await win.textContent('main h1');
      check(`settings page "${tab}" renders`, h1 && h1.length > 2, h1);
      await win.screenshot({ path: path.join(SHOTS, `settings-${tab}.png`) });
    }

    // Tray items switch the open window to the right page.
    await rg((r) => r.clickTray('AI tools...'));
    await sleep(400);
    check('tray > AI tools... shows the AI page', (await win.textContent('main h1')) === 'AI tools');

    // AI settings save into RadGesture.ini.
    await win.fill('#apiKey', 'sk-ant-e2e-test-key');
    await win.selectOption('#model', 'claude-haiku-4-5');
    await win.fill('#rules', 'Keep it short. No numbers.');
    await win.click('#saveAll');
    await sleep(600);
    const iniText = fs.existsSync(path.join(userData, 'RadGesture.ini')) ? fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1') : '';
    check('AI settings saved to RadGesture.ini', /ApiKey=sk-ant-e2e-test-key/.test(iniText) && /Model=claude-haiku-4-5/.test(iniText) && /ExtraRules=Keep it short\. No numbers\./.test(iniText));

    // Shortcut recorder: record Ctrl+Alt+J for Proofread.
    await win.click('#nav button[data-tab="shortcuts"]');
    await sleep(300);
    const recs = await win.$$('.recorder');
    await recs[1].click();
    await win.keyboard.press('Control+Alt+J');
    await sleep(200);
    await win.click('#saveAll');
    await sleep(600);
    const ini2 = fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1');
    check('shortcut recorder saves Ctrl+Alt+J to RadGesture.ini', /\[Behavior\][^[]*Hotkey=\^!j/.test(ini2));

    // Rings editor: add a ring, rename it, save.
    await win.click('#nav button[data-tab="rings"]');
    await sleep(300);
    await win.click('text=New ring');
    await sleep(300);
    await win.fill('#ringName', 'My new ring');
    await win.click('#saveAll');
    await sleep(600);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'menu.json'), 'utf8'));
    check('rings editor saves a new ring to menu.json', saved.categories.some((c) => c.name === 'My new ring'));
    await win.screenshot({ path: path.join(SHOTS, 'settings-rings-edited.png') });

    // Pick a direction and change its icon through the picker.
    await win.click('.rings .card:nth-child(2) .lrow');
    await sleep(250);
    check('selecting a direction shows its editor', !!(await win.$('#itemName')));

    // ---------------- the ring
    await rg((r) => r.openRing('click'));
    const ringPage = await waitFor(async () => app.windows().find((w) => w.url().includes('renderer/index.html')), 10000);
    const st = await waitFor(() => ringPage.evaluate(() => window.RGRing.state() && { levels: window.RGRing.state().levels.length, cat: window.RGRing.state().cat }), 5000);
    check('tray > Open the ring shows the ring', st && st.levels === 1);
    await sleep(500);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-open.png') });
    await ringPage.evaluate(() => document.querySelector('.center').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    await sleep(300);
    check('clicking the center switches to the next ring', (await ringPage.evaluate(() => window.RGRing.state().cat)) === 1);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-second.png') });
    await ringPage.evaluate(() => window.RGRing.clear());
    await app.evaluate(({}) => global.__rg && true);

    // Pause toggles from the tray.
    await rg((r) => r.clickTray('Pause the ring'));
    check('tray > Pause the ring pauses', (await rg((r) => r.status())).paused === true);
    await rg((r) => r.clickTray('Pause the ring'));
    check('pause turns off again', (await rg((r) => r.status())).paused === false);

    // ---------------- Windows only: the helper and real keys
    if (WIN) {
      const connected = await waitFor(async () => (await rg((r) => r.status())).helper.connected, 30000, 500);
      const hs = (await rg((r) => r.status())).helper;
      check('helper starts and checks in', connected, `mode=${hs.mode} err=${hs.lastError || '-'}`);
      const ev = async () => (await rg((r) => r.events())).map((e) => `${e.type} ${e.detail}`);
      check('saving settings made the helper reload', await waitFor(async () => (await ev()).some((e) => e === 'done reload'), 10000));

      const ahk = process.env.AHK_EXE;
      if (ahk && connected) {
        const inject = (mode) => spawnSync(ahk, [path.join(__dirname, 'inject.ahk'), mode], { timeout: 20000 });
        inject('flick');
        const flick = await waitFor(async () => (await ev()).some((e) => e.startsWith('done keys:{F13}')), 10000);
        check('real Ctrl+CapsLock + flick up runs the up direction', flick, (await ev()).slice(-8).join(' | '));
        inject('tap');
        const tap = await waitFor(async () => (await ev()).some((e) => e.startsWith('done keys:{F14}')), 10000);
        check('real Ctrl+CapsLock tap + click runs the clicked direction', tap, (await ev()).slice(-8).join(' | '));
      } else {
        check('AutoHotkey available for key injection', false, 'AHK_EXE not set or helper not connected');
      }
    }
  } catch (e) {
    check('no unexpected error', false, e.stack || e.message);
  } finally {
    let helperPid = null;
    try { helperPid = (await rg((r) => r.status())).helper.pid; } catch (_) {}
    await app.close().catch(() => {});
    if (WIN && helperPid) {
      await sleep(1500);
      let alive = false;
      try { alive = execFileSync('tasklist', ['/FI', `PID eq ${helperPid}`]).toString().includes(String(helperPid)); } catch (_) {}
      check('quitting RadGesture also stops the helper', !alive);
    }
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
