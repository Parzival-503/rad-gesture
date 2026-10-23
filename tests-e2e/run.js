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
  // Last: a ring of plain key presses for the Shortcuts page (the PACS ring
  // runs Library functions now, so it has no keys to record).
  menu.categories.push({
    id: 'e2e-keys', name: 'E2E keys', color: '#5cc8d6', icon: 'keyboard',
    items: [
      { name: 'Soft tissue', icon: 'contrast', action: 'helper:keys:{F15}' },
      { name: 'Lung', icon: 'pulmonology', action: 'helper:keys:{F16}' },
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
    for (const tab of ['rings', 'ai', 'shortcuts', 'library', 'general', 'status']) {
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
    await win.selectOption('#model', 'claude-haiku-5-5');
    await win.fill('#rules', 'Keep it short. No numbers.');
    await win.click('button:text-is("Opus 5.5")');
    await win.click('#saveAll');
    await sleep(600);
    const iniText = fs.existsSync(path.join(userData, 'RadGesture.ini')) ? fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1') : '';
    check('AI settings saved to RadGesture.ini', /ApiKey=sk-ant-e2e-test-key/.test(iniText) && /Model=claude-haiku-5-5/.test(iniText) && /ExtraRules=Keep it short\. No numbers\./.test(iniText));
    check('Impression can use Opus (saved to RadGesture.ini)', /\[Impression\][^[]*Model=claude-opus-5-5/.test(iniText));

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
    await win.screenshot({ path: path.join(SHOTS, 'settings-shortcuts-full.png'), fullPage: true });

    // Keys the ring presses: record a single key (as Sectra's often are) for
    // the first one, save, export, clear all, import, save: it comes back.
    const menuNow = () => JSON.parse(fs.readFileSync(path.join(userData, 'menu.json'), 'utf8'));
    const firstKeys = (m) => m.categories.find((c) => c.name === 'E2E keys').items.find((i) => i.name === 'Soft tissue');
    const krec = await win.$('.krow:has(.kname:text-is("Soft tissue")) .recorder');
    check('Shortcuts lists the keys the ring presses', !!krec && (await win.$$('.krow')).length >= 4, `${(await win.$$('.krow')).length} rows`);
    await krec.click();
    await win.keyboard.press('KeyW');
    await sleep(200);
    await win.click('#saveAll');
    await sleep(600);
    check('a single key recorded for a ring direction is saved', firstKeys(menuNow()).action === 'helper:keys:w', firstKeys(menuNow()).action);
    const setFile = path.join(userData, 'exported.rgkeys');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, setFile);
    await win.click('#exportKeys');
    await sleep(500);
    const exported = fs.existsSync(setFile) ? JSON.parse(fs.readFileSync(setFile, 'utf8')) : {};
    check('Export writes a shortcut set file', exported.format === 'radgesture-shortcuts' && exported.keys.length >= 4);
    check('the exported set carries the Library keys', !!(exported.library && exported.library.PACS_WL_Lung && exported.library.PACS_WL_Lung.Key === '2'));
    await win.click('#clearKeys');
    await win.click('#clearKeysYes');
    await win.click('#saveAll');
    await sleep(600);
    check('Clear all empties every ring key', firstKeys(menuNow()).action === 'helper:keys:' && !JSON.stringify(menuNow()).includes('helper:keys:{F13}'));
    await win.click('#importKeys');
    await sleep(500);
    await win.click('#saveAll');
    await sleep(600);
    check('Import puts the exported keys back', firstKeys(menuNow()).action === 'helper:keys:w' && JSON.stringify(menuNow()).includes('helper:keys:{F13}'));
    await win.$eval('.ktools', (el) => el.scrollIntoView());
    await sleep(200);
    await win.screenshot({ path: path.join(SHOTS, 'settings-shortcuts-list.png') });
    const lrec = await win.$('.krow:has(.kname:text-is("Lung")) .recorder');
    await lrec.click();
    await win.keyboard.down('Control');
    await win.keyboard.down('Alt');
    await sleep(150);
    check('the recorder shows held keys live', (await lrec.textContent()).includes('Ctrl') && (await lrec.textContent()).includes('Alt'), await lrec.textContent());
    await win.screenshot({ path: path.join(SHOTS, 'settings-shortcuts-recording.png') });
    await win.keyboard.up('Alt');
    await win.keyboard.up('Control');
    await win.keyboard.press('Escape');
    await sleep(150);

    // Library: Rad Optimizer's functions. One entry each; switch a shortcut on
    // and record it, change the key a function presses in Sectra, set the
    // username, look at the code, save: it all lands in RadGesture.ini.
    const libDef = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'library.json'), 'utf8'));
    await win.click('#nav button[data-tab="library"]');
    await sleep(350);
    check('Library lists every function', (await win.$$('.libfn')).length === libDef.functions.length, `${(await win.$$('.libfn')).length} of ${libDef.functions.length}`);
    check('Library opens with the "set the keys in Sectra first" note', !!(await win.$('#libSetup')) && /Sectra/.test(await win.textContent('#libSetup')));
    check('Library shows where a function sits on the rings', /PACS › Window \/ level › Lung/.test(await win.textContent('#lib-PACS_WL_Lung')));
    await win.click('#lib-LoginForget .libline .switch');
    await sleep(150);
    await win.click('#lib-LoginForget .recorder');
    await win.keyboard.press('Control+Alt+Shift+F9');
    await sleep(150);
    const lungRecs = await win.$$('#lib-PACS_WL_Lung .recorder');
    await lungRecs[1].click();
    await win.keyboard.press('KeyL');
    await sleep(150);
    await win.fill('#libUser', 'e2e-user');
    await win.click('#lib-PACS_Insert_Priors button:has-text("Code")');
    await sleep(200);
    check('Library shows a function\'s code', /Lib_InsertPriors/.test(await win.textContent('#lib-PACS_Insert_Priors .libcode')));
    await win.$eval('#lib-PACS_Insert_Priors', (el) => el.scrollIntoView());
    await win.screenshot({ path: path.join(SHOTS, 'settings-library-code.png') });
    await win.click('#saveAll');
    await sleep(700);
    const ini3 = fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1');
    check('Library saves a shortcut switched on and recorded', /\[Lib\.LoginForget\][^[]*On=1/.test(ini3) && /\[Lib\.LoginForget\][^[]*Hotkey=\^!\+F9/.test(ini3));
    check('Library saves the key pressed in Sectra', /\[Lib\.PACS_WL_Lung\][^[]*Key=l/.test(ini3) && /\[Lib\.PACS_WL_Lung\][^[]*Target=sectra/.test(ini3));
    check('Library saves the username (and no password anywhere)', /\[Library\][^[]*Username=e2e-user/.test(ini3) && !/password/i.test(ini3));
    await win.$eval('main', (el) => el.scrollTo(0, 0));
    await win.screenshot({ path: path.join(SHOTS, 'settings-library.png') });

    // My functions: write one, save: its script is in the functions folder.
    const marker = path.join(userData, 'my-function-ran.txt');
    await win.click('#addMyFunction');
    await sleep(250);
    await win.fill('#myFunctions .libfn:last-child input.myname', 'E2E marker');
    await win.fill('#myFunctions .libfn:last-child textarea.mycode', 'FileAppend, ran, ' + marker);
    await win.click('#saveAll');
    await sleep(700);
    const fnDir = path.join(userData, 'functions');
    const fnFiles = fs.existsSync(fnDir) ? fs.readdirSync(fnDir) : [];
    const myId = fnFiles.length ? fnFiles[0].replace(/\.ahk$/, '') : '';
    check('My functions: a new function is saved as its own script', fnFiles.length === 1 && fs.readFileSync(path.join(fnDir, fnFiles[0]), 'utf8').includes('FileAppend, ran, '), fnFiles.join(','));
    check('My functions: listed for the helper', new RegExp('Custom=' + myId).test(fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1')));
    await win.$eval('#myFunctions', (el) => el.scrollIntoView());
    await win.screenshot({ path: path.join(SHOTS, 'settings-library-mine.png') });

    // The ring editor offers Library functions, with the key note.
    await win.click('#nav button[data-tab="rings"]');
    await sleep(300);
    await win.click('.rings .card:first-child .lrow:has-text("PACS")');
    await sleep(200);
    await win.click('.rings .card:nth-child(2) .lrow:has-text("Insert priors")');
    await sleep(200);
    check('a PACS direction is a Library function in the ring editor', (await win.$eval('#libPick', (e) => e.value)) === 'PACS_Insert_Priors');
    check('the ring editor says which key it presses in Sectra', /Presses Ctrl\+P/.test(await win.textContent('.editor')));
    await win.screenshot({ path: path.join(SHOTS, 'settings-rings-library.png') });

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

    // Icons: a Tabler icon, then a picture of your own.
    const lastRing = () => menuNow().categories.find((c) => c.name === 'My new ring').items[0];
    await win.click('#changeIcon');
    await win.click('.packs button[data-pack="tabler"]');
    await sleep(150);
    await win.screenshot({ path: path.join(SHOTS, 'settings-icon-tabler.png') });
    await win.fill('#iconSearch', 'lungs');
    await sleep(150);
    await win.click('.icongrid button[title="lungs"]');
    await win.click('#saveAll');
    await sleep(600);
    check('a Tabler icon can be picked and is saved', lastRing().icon === 'ti:lungs', lastRing().icon);
    const pic = path.join(ROOT, 'assets', 'icon.png');
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, pic);
    await win.click('#changeIcon');
    await win.click('.packs button[data-pack="mine"]');
    await win.click('#addPicture');
    await sleep(500);
    await win.screenshot({ path: path.join(SHOTS, 'settings-icon-picture.png') });
    await win.click('#saveAll');
    await sleep(600);
    const picIcon = lastRing().icon || '';
    check('a picture of your own becomes the icon (kept in the data folder)', picIcon.startsWith('img:') && fs.existsSync(path.join(userData, 'icons', picIcon.slice(4))), picIcon);

    // "Open a program": choose one, its own icon comes along, start with RadGesture.
    await win.click('.field .seg button:has-text("Open a program")');
    await sleep(200);
    const prog = process.env.RG_APP_EXE || require(path.join(ROOT, 'node_modules', 'electron'));
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, prog);
    await win.click('#pickProgram');
    await sleep(700);
    await win.click('button.switch[aria-label="Start it with RadGesture"]');
    await win.screenshot({ path: path.join(SHOTS, 'settings-open-program.png') });
    await win.click('#saveAll');
    await sleep(600);
    const appItem = lastRing();
    check('Open a program saves the program, and starting with RadGesture', appItem.action === 'app:' + prog && appItem.startWithHub === true, JSON.stringify(appItem).slice(0, 200));
    if (WIN) check('the program\'s own icon is taken', (appItem.icon || '').startsWith('img:app-'), appItem.icon);

    // Theme: pick one in General, Settings repaints in it, it is saved.
    await win.click('#nav button[data-tab="general"]');
    await sleep(300);
    check('General shows every theme', (await win.$$('.tpick')).length >= 8, `${(await win.$$('.tpick')).length} tiles`);
    await win.click('.tpick[data-theme-id="synthwave"]');
    await sleep(300);
    check('picking a theme repaints Settings in it', (await win.evaluate(() => document.documentElement.dataset.theme)) === 'synthwave');
    await win.screenshot({ path: path.join(SHOTS, 'settings-general-synthwave.png') });
    await win.click('#saveAll');
    await sleep(600);
    check('the theme is saved', menuNow().theme === 'synthwave', menuNow().theme);

    // ---------------- the ring
    await rg((r) => r.openRing('click'));
    const ringPage = await waitFor(async () => app.windows().find((w) => w.url().includes('renderer/index.html')), 10000);
    const st = await waitFor(() => ringPage.evaluate(() => window.RGRing.state() && { levels: window.RGRing.state().levels.length, cat: window.RGRing.state().cat }), 5000);
    check('tray > Open the ring shows the ring', st && st.levels === 1);
    check('the ring opens in the saved theme', (await ringPage.evaluate(() => document.getElementById('stage').dataset.theme)) === 'synthwave');
    await sleep(500);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-open.png') });
    const c0 = await ringPage.evaluate(() => ({ x: window.RGRing.state().x, y: window.RGRing.state().y }));
    await ringPage.mouse.click(c0.x, c0.y);
    await sleep(300);
    check('clicking the center switches to the next ring', (await ringPage.evaluate(() => window.RGRing.state().cat)) === 1);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-second.png') });
    const chip = await ringPage.$('.dchip[data-cat="3"]');
    if (chip) await chip.click();
    await sleep(300);
    check('a button under the ring jumps straight to that ring', (await ringPage.evaluate(() => window.RGRing.state().cat)) === 3);
    await ringPage.mouse.move(c0.x, c0.y);
    await ringPage.mouse.down();
    await ringPage.mouse.move(c0.x - 200, c0.y - 80, { steps: 10 });
    await ringPage.mouse.up();
    await sleep(300);
    const c1 = await ringPage.evaluate(() => { const s = window.RGRing.state(); return s && { x: s.x, y: s.y, cat: s.cat }; });
    check('dragging the center moves the ring (and keeps it open)', c1 && Math.abs(c1.x - (c0.x - 200)) < 3 && c1.cat === 3, JSON.stringify(c1));
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-dragged.png') });
    const lastCat = (await ringPage.$$('.dchip')).length - 1;
    await (await ringPage.$(`.dchip[data-cat="${lastCat}"]`)).click();
    await sleep(400);
    check('the ring draws a picture icon', (await ringPage.$$('.node img.imgic')).length > 0);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-picture-icon.png') });
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

      // "Open a program" through the helper: "front" must not start a second copy.
      const notepads = () => { try { return (execFileSync('tasklist', ['/FI', 'IMAGENAME eq notepad.exe']).toString().match(/notepad\.exe/gi) || []).length; } catch (_) { return -1; } };
      const runVia = (spec) => win.evaluate((x) => window.rgs.runHelperAction(x), spec);
      await runVia('run:front|notepad.exe|');
      await waitFor(async () => notepads() >= 1, 8000);
      await sleep(800);
      await runVia('run:front|notepad.exe|');
      await waitFor(async () => (await ev()).filter((e) => e === 'done run:front|notepad.exe|').length >= 2, 8000);
      await sleep(800);
      check('Open a program starts it, and brings it up instead of a second copy', notepads() === 1, `notepad processes: ${notepads()}`);
      await runVia('run:new|notepad.exe|');
      await waitFor(async () => notepads() >= 2, 8000);
      check('"Open another copy" does open another', notepads() === 2, `notepad processes: ${notepads()}`);
      try { execFileSync('taskkill', ['/F', '/IM', 'notepad.exe']); } catch (_) {}

      // Library: from the ring (as Try it does) and from its own keyboard
      // shortcut, recorded above, pressed for real by a second script.
      if (myId) {
        await runVia('lib:' + myId);
        check('My functions: a function you wrote runs (bundled AutoHotkey)', await waitFor(() => fs.existsSync(marker), 10000), (await ev()).slice(-4).join(' | '));
      }
      await runVia('lib:LoginForget');
      check('a Library function runs in the helper', await waitFor(async () => (await ev()).some((e) => e === 'done lib:LoginForget'), 8000));
      if (process.env.AHK_EXE) {
        const pressFile = path.join(userData, 'press-lib.ahk');
        fs.writeFileSync(pressFile, '#NoTrayIcon\r\nSendLevel, 1\r\nSend, ^!+{F9}\r\nExitApp\r\n');
        spawnSync(process.env.AHK_EXE, [pressFile], { timeout: 15000 });
        check('a Library keyboard shortcut runs its function', await waitFor(async () => (await ev()).some((e) => e === 'done lib-key:LoginForget'), 8000), (await ev()).slice(-6).join(' | '));
      }

      const ahk = process.env.AHK_EXE;
      if (ahk && connected) {
        const inject = (mode) => spawnSync(ahk, [path.join(__dirname, 'inject.ahk'), mode], { timeout: 20000 });
        inject('flick');
        const flick = await waitFor(async () => (await ev()).some((e) => e.startsWith('done keys:{F13}')), 10000);
        check('real Ctrl+CapsLock + flick up runs the up direction', flick, (await ev()).slice(-8).join(' | '));
        inject('tap');
        const tap = await waitFor(async () => (await ev()).some((e) => e.startsWith('done keys:{F14}')), 10000);
        check('real Ctrl+CapsLock tap + click runs the clicked direction', tap, (await ev()).slice(-8).join(' | '));
        await sleep(600);
        const page = app.windows().find((w) => w.url().includes('renderer/index.html'));
        // Where the 3rd ring button will be once the ring opens at screen center
        // (open it the same way first, read the real position, close it).
        await rg((r) => r.openRing('click'));
        await sleep(700);
        const chipAt = await page.evaluate(() => {
          const r = document.querySelector('.dchip[data-cat="2"]').getBoundingClientRect();
          // Below the ring at screen center; near the bottom edge it flips above.
          return { x: Math.round(r.x + r.width / 2 - window.RGRing.state().x), y: Math.abs(Math.round(r.y + r.height / 2 - window.RGRing.state().y)) };
        });
        await page.evaluate(() => window.RGRing.clear());
        await rg((r) => r.hideRing());
        await sleep(400);
        const scr = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
        spawnSync(ahk, [path.join(__dirname, 'inject.ahk'), 'move', String(Math.floor(scr.w / 2) + chipAt.x), String(Math.floor(scr.h / 2) + chipAt.y)], { timeout: 20000 });
        await sleep(500);
        const mv = await page.evaluate(() => { const s = window.RGRing.state(); return s && { cat: s.cat, x: s.x, y: s.y, w: innerWidth, h: innerHeight }; });
        await page.screenshot({ path: path.join(SHOTS, 'win-ring-moved.png') }).catch(() => {});
        check('real mouse: a button under the ring switches rings', mv && mv.cat === 2, JSON.stringify(mv));
        check('real mouse: dragging the center moves the ring', mv && Math.abs(mv.x - (mv.w / 2 - 200)) < 12 && Math.abs(mv.y - (mv.h / 2 - 80)) < 12, JSON.stringify(mv));
        await page.evaluate(() => window.RGRing.clear()).catch(() => {});
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
