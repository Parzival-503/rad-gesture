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

// A hang must fail with a log, not run out the job's clock: a cancelled job
// keeps no log and no screenshots.
let lastCheck = '(before the first check)';
const WATCHDOG_MIN = Number(process.env.RG_E2E_WATCHDOG_MIN || 8);
setTimeout(() => {
  console.log(`FAIL  watchdog: still running after ${WATCHDOG_MIN} min; the last check was "${lastCheck}"`);
  process.exit(2);
}, WATCHDOG_MIN * 60000).unref();

function check(name, ok, detail = '') {
  lastCheck = name;
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
  app.context().setDefaultTimeout(20000); // no click or read may wait forever
  app.process().stdout.on('data', (d) => process.stdout.write('  [app] ' + d));

  const rg = (fn, arg) => app.evaluate(({}, [src, a]) => {
    // eslint-disable-next-line no-new-func
    return new Function('rg', 'a', 'return (' + src + ')(rg, a)')(global.__rg, a);
  }, [fn.toString(), arg]);

  try {
    check('hub started', await waitFor(() => app.evaluate(() => !!global.__rg), 20000));

    // ---------------- tray
    const labels = await rg((r) => r.trayLabels());
    for (const l of ['Open the ring', 'Settings...', 'Edit rings...', 'AI tools...', 'Shortcuts...', 'Pause the ring', 'Start with Windows', 'Status and help...', 'Prior checklist > Show the Priors toolbar', 'Prior checklist > Make the checklist', 'AI > Test the API key', 'AI > Proofread history...', 'Advanced > Restart the helper', 'Quit RadGesture']) {
      check(`tray has "${l}"`, labels.includes(l));
    }

    // ---------------- settings window, every page
    await rg((r) => r.clickTray('Settings...'));
    const win = await waitFor(async () => app.windows().find((w) => w.url().includes('settings')), 15000);
    check('tray > Settings... opens the Settings window', !!win);
    if (win) win.on('pageerror', (e) => console.log('  [settings page error] ' + (e && e.stack || e)));
    await win.waitForFunction(() => window.__settingsReady === true, null, { timeout: 15000 });
    check('Settings opens above every other window', await waitFor(() => rg((r) => r.settingsOnTop()), 3000));
    await win.setViewportSize({ width: 1200, height: 780 }).catch(() => {});
    for (const tab of ['rings', 'ai', 'shortcuts', 'functions', 'workflow', 'general', 'status']) {
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
    await win.click('#nav button[data-tab="functions"]');
    await sleep(350);
    // Tiles (the default): one small tile each, the finer filters folded, the
    // first tiles on the first screen; a click opens the full entry in place.
    check('Functions opens as one tile per function', (await win.$$('.fntile')).length === libDef.functions.length && (await win.$$('.libfn')).length === 0, `${(await win.$$('.fntile')).length} tiles`);
    check('Functions: the finer filters start folded', !(await win.$('#fnFilters .fxmore')) && !!(await win.$('#fxMore')));
    await win.$eval('main', (el) => el.scrollTo(0, 0));
    await sleep(100);
    const firstTile = await (await win.$('.fntile')).boundingBox();
    check('Functions: the first tiles are on the first screen', firstTile && firstTile.y + firstTile.height < (await win.evaluate(() => window.innerHeight)), firstTile && `tile at y=${Math.round(firstTile.y)}`);
    await win.screenshot({ path: path.join(SHOTS, 'settings-functions-tiles.png') });
    await win.click('#tile-PACS_Insert_Measurement');
    await sleep(300);
    check('Functions: a tile opens its full entry under it', !!(await win.$('.fndetail #lib-PACS_Insert_Measurement.libfn')) && (await win.$$('.libfn')).length === 1 && /Try it/.test(await win.textContent('.fndetail')));
    await win.screenshot({ path: path.join(SHOTS, 'settings-functions-tile-open.png') });
    await win.click('.fndetail button[aria-label^="Close"]');
    await sleep(200);
    check('Functions: the open tile closes again', !(await win.$('.fndetail')));
    await win.click('#fxMore');
    await sleep(150);
    check('Functions: Filters shows the finer filters', !!(await win.$('#fnFilters .fxmore')) && /Works in/.test(await win.textContent('#fnFilters')));
    await win.click('#fxMore');
    await win.click('#fnFilters button:text-is("Detailed")');
    await sleep(300);
    check('Functions lists every function', (await win.$$('.libfn')).length === libDef.functions.length, `${(await win.$$('.libfn')).length} of ${libDef.functions.length}`);
    check('Functions opens with the "set the keys in Sectra first" note', !!(await win.$('#libSetup')) && /Sectra/.test(await win.textContent('#libSetup')));
    check('"Read first" starts folded', !(await win.$('#copyLibKeys')));
    await win.click('#readFirst');
    await sleep(150);
    check('"Read first" opens its steps', !!(await win.$('#copyLibKeys')) && /Keys in Sectra and PowerScribe/.test(await win.textContent('#libSetup')));
    await win.screenshot({ path: path.join(SHOTS, 'functions-top.png') }).catch(() => {});
    await win.click('#readFirst');
    await sleep(150);
    check('every function starts switched on', (await win.$$('.switch[aria-label^="Keyboard shortcut for"][aria-checked="false"]')).length === 0);
    check('Functions shows where a function sits on the rings', /PACS › Window \/ level › Lung/.test(await win.textContent('#lib-PACS_WL_Lung')));
    await win.click('#lib-LoginForget .libline .switch');
    await sleep(150);
    await win.click('#lib-LoginForget .libline .switch');
    await sleep(150);
    await win.click('#lib-LoginForget .recorder');
    await win.keyboard.press('Control+Alt+Shift+F9');
    await sleep(150);
    const lungRecs = await win.$$('#lib-PACS_WL_Lung .recorder');
    await lungRecs[1].click();
    await win.keyboard.press('KeyL');
    await sleep(150);
    check('Functions points to the Workflow page for the username', !!(await win.$('#nav button[data-tab="workflow"]')) && /Workflow page/.test(await win.textContent('main')));
    // Workflow: the username, the logins, Epic / Teams, programs, websites.
    await win.click('#nav button[data-tab="workflow"]');
    await sleep(300);
    check('Workflow gathers logins, apps and websites', !!(await win.$('#wfLogin #libUser')) && !!(await win.$('#wfApps #lib-ActivateEPIC')) && !!(await win.$('#wfApps #lib-ActivateTeams')) && !!(await win.$('#wfWeb #lib-OpenChromeTabs')));
    await win.fill('#libUser', 'e2e-user');
    await win.screenshot({ path: path.join(SHOTS, 'settings-workflow.png') });
    await win.click('#nav button[data-tab="functions"]');
    await sleep(300);
    const back = await win.evaluate(() => ({
      h1: (document.querySelector('main h1') || {}).textContent,
      view: (document.querySelector('#fnFilters .seg button.on') || {}).textContent,
      entries: document.querySelectorAll('.libfn').length,
      tiles: document.querySelectorAll('.fntile').length,
      priors: !!document.getElementById('lib-PACS_Insert_Priors'),
    }));
    check('Functions keeps the Detailed view after another page', back.priors && back.entries === libDef.functions.length, JSON.stringify(back));
    await win.click('#lib-PACS_Insert_Priors button:has-text("Code")');
    await sleep(200);
    check('Functions shows a function\'s code', /Lib_InsertPriors/.test(await win.textContent('#lib-PACS_Insert_Priors .libcode')));
    await win.$eval('#lib-PACS_Insert_Priors', (el) => el.scrollIntoView());
    await win.screenshot({ path: path.join(SHOTS, 'settings-library-code.png') });
    await win.click('#saveAll');
    await sleep(700);
    const ini3 = fs.readFileSync(path.join(userData, 'RadGesture.ini'), 'latin1');
    check('Functions saves a shortcut switched on and recorded', /\[Lib\.LoginForget\][^[]*On=1/.test(ini3) && /\[Lib\.LoginForget\][^[]*Hotkey=\^!\+F9/.test(ini3));
    check('Functions saves the key pressed in Sectra', /\[Lib\.PACS_WL_Lung\][^[]*Key=l/.test(ini3) && /\[Lib\.PACS_WL_Lung\][^[]*Target=sectra/.test(ini3));
    check('Workflow saves the username (and no password anywhere)', /\[Library\][^[]*Username=e2e-user/.test(ini3) && !/password/i.test(ini3));
    await win.$eval('main', (el) => el.scrollTo(0, 0));
    await win.screenshot({ path: path.join(SHOTS, 'settings-library.png') });

    // Search and filters.
    await win.fill('#libSearch', 'ctrl+alt+p');
    await sleep(250);
    check('Functions: a typed shortcut finds its function', (await win.$$('.libfn')).length === 1 && !!(await win.$('#lib-PACS_Insert_Priors')), `${(await win.$$('.libfn')).length} shown`);
    await win.fill('#libSearch', '');
    await win.click('.fxchip[data-group="Logins"]');
    await sleep(200);
    check('Functions: a group filter shows only that group', (await win.$$('.libfn')).length === 4 && (await win.textContent('#fxCount')).startsWith('4 of'), await win.textContent('#fxCount'));
    await win.click('#fxClear');
    await win.click('#fnFilters button:text-is("Compact")');
    await sleep(250);
    check('Functions: the compact view is one line per function', (await win.$$('.fnrow')).length === libDef.functions.length, `${(await win.$$('.fnrow')).length} rows`);
    await win.screenshot({ path: path.join(SHOTS, 'settings-functions-compact.png') });
    await win.click('#lib-PACS_WL_Lung');
    await sleep(200);
    check('Functions: a compact line opens to the full entry', !!(await win.$('#lib-PACS_WL_Lung.libfn')));
    await win.click('#fnFilters button:text-is("Detailed")');
    await win.click('#fxMore');
    await win.click('#fnFilters button:text-is("Not on one")');
    await sleep(200);
    check('Functions: "not on a ring" filter', !(await win.$('#lib-PACS_WL_Lung')) && !!(await win.$('#lib-PS_PasteIndication')));
    await win.click('#fxClear');
    await sleep(200);

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

    // Functions page: Export my functions / Import functions (same file
    // format as Shortcuts, only My functions inside).
    const fnFile = path.join(userData, 'my-functions.rgkeys');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, fnFile);
    await win.click('#exportFunctions');
    await sleep(500);
    let fnSet = null;
    try { fnSet = JSON.parse(fs.readFileSync(fnFile, 'utf8')); } catch (_) {}
    check('Functions: Export my functions writes only my functions', !!fnSet && fnSet.functions.length === 1 && fnSet.functions[0].id === myId && fnSet.keys.length === 0, fnSet ? `${fnSet.functions.length} functions, ${fnSet.keys.length} keys` : 'no file');
    fnSet.functions = [{ id: 'mye2eimport', name: 'E2E imported', description: 'from a file', code: 'Sleep, 10' }];
    fnSet.library = { mye2eimport: { On: '0', Hotkey: '' } };
    fs.writeFileSync(fnFile, JSON.stringify(fnSet));
    await win.click('#importFunctions');
    await sleep(400);
    check('Functions: Import functions adds it to My functions', !!(await win.$('#myFunctions #lib-mye2eimport')));
    await win.click('#saveAll');
    await sleep(700);
    check('Functions: an imported function is saved as its own script', fs.existsSync(path.join(fnDir, 'mye2eimport.ahk')));
    await win.$eval('#myFunctions', (el) => el.scrollIntoView());
    await win.screenshot({ path: path.join(SHOTS, 'settings-library-mine.png') });

    // Reference Library: write a formatted note (it shows formatted as you
    // type, lists continue on Enter), it saves itself, put it on the ring;
    // add the clipboard from the tray; open it in the viewer.
    const refsDir = path.join(userData, 'references');
    const refIndex = () => (fs.existsSync(path.join(refsDir, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(refsDir, 'index.json'), 'utf8')) : []);
    await win.click('#nav button[data-tab="references"]');
    await sleep(500);
    check('the Reference Library page opens', (await win.textContent('main h1')) === 'Reference Library');
    const gal = () => menuNow().categories.find((c) => c.id === 'gallery');
    const secOnRing = (name) => (gal().items || []).find((i) => i.name === name && i.items);
    check('the Reference Library shows its sections', (await win.$$eval('.refsec', (els) => els.map((e) => e.dataset.section))).join('|').startsWith('CT Chest|Abdomen|Ultrasound|PET-CT'));
    check('the shipped guideline links are listed in their sections', (await win.$$('.refrow[data-link]')).length >= 13, `${(await win.$$('.refrow[data-link]')).length} links`);
    await win.click('.refrow[data-link="Fleischner 2017"]');
    await sleep(200);
    check('a link opens in its editor (name, address, section)', /rsna\.org/.test(await win.$eval('#linkUrl', (e) => e.value)) && (await win.$eval('#linkName', (e) => e.value)) === 'Fleischner 2017' && (await win.$eval('#refSection', (e) => e.selectedOptions[0].textContent)) === 'CT Chest');
    // Sections: a new one, a renamed one.
    await win.click('#refNewSection');
    await sleep(250);
    await win.fill('#secName', 'Neuro');
    await sleep(150);
    await win.click('.refsec[data-section="Ultrasound"]');
    await sleep(200);
    await win.fill('#secName', 'US and OB');
    await sleep(150);
    check('a section can be added and renamed', !!(await win.$('.refsec[data-section="Neuro"]')) && !!(await win.$('.refsec[data-section="US and OB"]')));
    // A note, a PDF and a picture, all into the Neuro section.
    await win.click('.refsec[data-section="Neuro"]');
    await sleep(200);
    check('new things go into the section being looked at', (await win.$eval('#refTarget', (e) => e.selectedOptions[0].textContent)) === 'Neuro');
    await win.click('#refNew');
    await sleep(500);
    await win.click('#refBody');
    await win.keyboard.press('End');
    await win.keyboard.type('## Lung nodules\n\n| Size | Follow-up |\n|---|---|\n| < 6 mm | None |\n\n- first');
    await win.keyboard.press('Enter');
    await win.keyboard.type('second');
    await sleep(900);
    const prev = await win.innerHTML('#refPreview');
    check('a note shows formatted as you type (heading, table, list)', /<h2>Lung nodules<\/h2>/.test(prev) && /<table>/.test(prev) && /<li>first<\/li><li>second<\/li>/.test(prev), prev.slice(0, 160));
    const noteId = (refIndex()[0] || {}).id;
    check('a note saves itself', !!noteId && /## Lung nodules/.test(fs.readFileSync(path.join(refsDir, noteId + '.md'), 'utf8')));
    const pdfSrc = path.join(userData, 'Invented article.pdf');
    fs.writeFileSync(pdfSrc, '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, pdfSrc);
    await win.click('.refsec[data-section="Neuro"]');
    await sleep(200);
    await win.click('#refAddFile');
    await sleep(700);
    const pdfRef = refIndex().find((r) => r.fileName === 'Invented article.pdf');
    check('a file (PDF) is copied into the Reference Library', !!pdfRef && fs.existsSync(path.join(refsDir, pdfRef.file)));
    const pngSrc = path.join(userData, 'Invented table.png');
    const pngB64 = await app.evaluate(({ nativeImage }) => {
      const w = 900, hh = 600, buf = Buffer.alloc(w * hh * 4);
      for (let i = 0; i < w * hh; i++) { const x = i % w, y = (i / w) | 0; buf[i * 4] = 160; buf[i * 4 + 1] = (y * 255 / hh) | 0; buf[i * 4 + 2] = (x * 255 / w) | 0; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: hh }).toPNG().toString('base64');
    });
    fs.writeFileSync(pngSrc, Buffer.from(pngB64, 'base64'));
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, pngSrc);
    await win.click('.refsec[data-section="Neuro"]');
    await sleep(200);
    await win.click('#refAddFile');
    await sleep(800);
    const picRef = refIndex().find((r) => r.image);
    check('a picture file is added as a picture', !!picRef && picRef.title === 'Invented table');
    await win.click('#saveAll');
    await sleep(700);
    const neuro = secOnRing('Neuro');
    const acts = neuro ? neuro.items.map((i) => i.action) : [];
    check('the section is on the ring with what was added to it', acts.includes('ref:' + noteId) && !!pdfRef && acts.includes('ref:' + pdfRef.id) && !!picRef && acts.includes('ref:' + picRef.id), acts.join(' '));
    check('a renamed section is renamed on the ring', !!secOnRing('US and OB') && !secOnRing('Ultrasound'));
    // Move the note to CT Chest.
    await win.click(`.refrow[data-ref="${noteId}"]`);
    await sleep(200);
    await win.selectOption('#refSection', { label: 'CT Chest' });
    await sleep(200);
    await win.click('#saveAll');
    await sleep(700);
    check('a note moves to another section', secOnRing('CT Chest').items.some((i) => i.action === 'ref:' + noteId) && !secOnRing('Neuro').items.some((i) => i.action === 'ref:' + noteId));
    // The PDF opens in the reader.
    await win.click(`.refrow[data-ref="${pdfRef.id}"]`);
    await sleep(200);
    await win.click('.reffile');
    const readerUrl = await waitFor(async () => rg((r) => r.readerUrl()), 6000);
    check('a PDF opens in the reader window', /\.pdf$/.test(String(readerUrl)), String(readerUrl));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => /\.pdf$/.test(w.webContents.getURL())).forEach((w) => w.close()));
    // The picture: zoom with the wheel, back to fit.
    await win.click(`.refrow[data-ref="${picRef.id}"]`);
    await sleep(200);
    await win.click('#refOpen');
    const pv = await waitFor(async () => app.windows().find((w) => w.url().includes('viewer')), 8000);
    if (pv) {
      await pv.waitForFunction(() => window.__viewerReady === true, null, { timeout: 8000 }).catch(() => {});
      const z0 = await pv.evaluate(() => window.__viewerZoom);
      const box = await (await pv.$('#stage')).boundingBox();
      await pv.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 4; i++) { await pv.mouse.wheel(0, -120); await sleep(60); }
      const z1 = await pv.evaluate(() => window.__viewerZoom);
      await pv.mouse.down();
      await pv.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60, { steps: 5 });
      await pv.mouse.up();
      await pv.screenshot({ path: path.join(SHOTS, 'reference-picture-zoomed.png') });
      await pv.click('#zoomFit');
      const z2 = await pv.evaluate(() => window.__viewerZoom);
      check('a picture zooms with the wheel and fits again', z1 > z0 * 1.5 && Math.abs(z2 - z0) < 0.01, `${z0} -> ${z1} -> ${z2}`);
      await pv.keyboard.press('Escape').catch(() => {});
      await sleep(400);
    } else check('a picture zooms with the wheel and fits again', false, 'no viewer');
    // A topic: the LI-RADS link becomes a topic, and a PDF and a picture join it.
    await win.click('.refrow[data-link="LI-RADS v2018"]');
    await sleep(200);
    await win.click('#refMakeTopic');
    await sleep(250);
    await win.fill('#topicName', 'LI-RADS');
    await sleep(150);
    check('new things go into the topic being looked at', (await win.$eval('#refTarget', (e) => e.selectedOptions[0].textContent)) === 'Abdomen › LI-RADS');
    for (const f of [pdfSrc, pngSrc]) {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, f);
      await win.click('.reftopic[data-topic="LI-RADS"]');
      await sleep(200);
      await win.click('#refAddFile');
      await sleep(800);
    }
    await win.click('#saveAll');
    await sleep(700);
    const liTopic = (secOnRing('Abdomen').items || []).find((i) => i.name === 'LI-RADS' && i.items);
    const liKinds = liTopic ? liTopic.items.map((i) => i.action.split(':')[0]).join(',') : '';
    check('a topic holds a link, a PDF and a picture together on the ring', liKinds === 'url,ref,ref', liKinds || 'no topic');
    // Reordering: drag a resource above another, Move down, drag a tool; the
    // ring keeps the new order. Then Export library writes a readable folder.
    {
      const chestNames = () => (secOnRing('CT Chest').items || []).map((i) => i.name);
      const before = chestNames();
      await win.$eval('main', (el) => el.scrollTo(0, 0));
      await win.$eval('[data-keep-scroll="refs"]', (el) => { el.scrollTop = 0; }); // the list now stays where it was scrolled
      await win.dragAndDrop('[data-key="it:0:1"] .grip', '[data-key="it:0:0"]', { targetPosition: { x: 30, y: 3 } });
      await sleep(300);
      await win.click('#saveAll');
      await sleep(600);
      const afterDrag = chestNames();
      check('dragging a resource above another reorders it on the ring', afterDrag[0] === before[1] && afterDrag[1] === before[0], `${before.slice(0, 2)} -> ${afterDrag.slice(0, 2)}`);
      await win.click('[data-key="it:0:0"]');
      await sleep(200);
      await win.click('#entryDown');
      await sleep(200);
      await win.click('#saveAll');
      await sleep(600);
      check('Move down moves it one place', chestNames()[1] === afterDrag[0], chestNames().slice(0, 2).join(', '));
      // A click or a move in a long list keeps it where it was scrolled.
      await win.evaluate(() => { const st = document.createElement('style'); st.id = 'e2eShort'; st.textContent = '.reflist .list.reftree { max-height: 160px !important; }'; document.head.appendChild(st); });
      await win.$eval('[data-keep-scroll="refs"]', (el) => { el.scrollTop = 70; });
      const y0 = await win.$eval('[data-keep-scroll="refs"]', (el) => el.scrollTop);
      const visKey = await win.$eval('[data-keep-scroll="refs"]', (el) => { const a = el.getBoundingClientRect(); const r = [...el.querySelectorAll('.refrow[data-key^="it:"]')].find((x) => { const b = x.getBoundingClientRect(); return b.top >= a.top && b.bottom <= a.bottom; }); return r && r.dataset.key; });
      if (visKey) await win.click(`[data-key="${visKey}"]`);
      await sleep(200);
      const y1 = await win.$eval('[data-keep-scroll="refs"]', (el) => el.scrollTop);
      check('clicking in the list keeps it scrolled where it was', y0 > 0 && Math.abs(y1 - y0) < 2, `${y0} -> ${y1} (${visKey})`);
      if (await win.$eval('#entryDown', (b) => !b.disabled).catch(() => false)) {
        await win.click('#entryDown');
        await sleep(200);
        const y2 = await win.$eval('[data-keep-scroll="refs"]', (el) => el.scrollTop);
        const inView = await win.$eval('[data-keep-scroll="refs"]', (el) => { const a = el.getBoundingClientRect(), b = el.querySelector('.on').getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; });
        check('Move down does not jump the list back to the top', y2 > 0 && inView, `scrollTop ${y2}, moved row in view: ${inView}`);
      }
      await win.evaluate(() => document.getElementById('e2eShort').remove());
      await win.click('#saveAll');
      await sleep(400);
      // The divider between list and editor moves, and the width is kept.
      const listW = () => win.$eval('.reflist', (el) => el.getBoundingClientRect().width);
      const w0 = await listW();
      const bar = await win.$eval('#refSplit', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; });
      await win.mouse.move(bar.x, bar.y);
      await win.mouse.down();
      await win.mouse.move(bar.x + 60, bar.y, { steps: 4 });
      await win.mouse.move(bar.x + 120, bar.y, { steps: 4 });
      await win.mouse.up();
      await sleep(150);
      const w1 = await listW();
      await win.click('[data-key="sec:0"]');
      await sleep(200);
      const w2 = await listW();
      check('dragging the divider widens the list, and it stays that wide', w1 > w0 + 60 && Math.abs(w2 - w1) < 2, `${Math.round(w0)} -> ${Math.round(w1)} -> ${Math.round(w2)}`);
      await win.dblclick('#refSplit');
      await sleep(150);
      const toolsOnRing = () => (gal().items || []).filter((i) => ['Search copied text', 'My documents', 'Add from clipboard'].includes(i.name)).map((i) => i.name);
      check('the ring\'s tools are listed and can be moved', (await win.$$('[data-key^="tool:"]')).length === 3);
      await win.dragAndDrop('[data-key="tool:2"] .grip', '[data-key="tool:0"]', { targetPosition: { x: 30, y: 3 } });
      await sleep(300);
      await win.click('#saveAll');
      await sleep(600);
      check('dragging a tool moves it on the ring', toolsOnRing()[0] === 'Add from clipboard', toolsOnRing().join(', '));
      await win.screenshot({ path: path.join(SHOTS, 'settings-ref-reorder.png') });
      const expDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rg-export-'));
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, expDir);
      await win.click('#refExport');
      const out = await waitFor(async () => { const d = fs.readdirSync(expDir)[0]; return d && path.join(expDir, d); }, 6000);
      const sec = out ? fs.readdirSync(out) : [];
      const chestDir = out && sec.find((d) => /CT Chest$/.test(d));
      const inChest = chestDir ? fs.readdirSync(path.join(out, chestDir)) : [];
      check('Export library writes a folder per section with readable names', sec.some((d) => /^01 /.test(d)) && inChest.some((f) => /\.url$/.test(f)), `${sec.join(' | ')} :: ${inChest.slice(0, 4).join(' | ')}`);
    }
    await win.click('.reftopic[data-topic="LI-RADS"]');
    await sleep(200);
    await win.$eval('main', (el) => el.scrollTo(0, 0));
    await win.screenshot({ path: path.join(SHOTS, 'settings-references-topic.png') });
    await win.$eval('main', (el) => el.scrollTo(0, 0));
    await win.screenshot({ path: path.join(SHOTS, 'settings-references.png') });
    await app.evaluate(({ clipboard }) => { clipboard.clear(); clipboard.writeText('# Bosniak 2019\n\n- **IIF**: follow up at 6 months'); });
    await rg((r) => r.clickTray('Add clipboard to the Reference Library'));
    await sleep(900);
    const bos = refIndex().find((r) => r.title === 'Bosniak 2019');
    check('the tray adds the clipboard to the Reference Library', !!bos);
    check('and Settings opens on it', (await win.$eval('#refTitle', (e) => e.value).catch(() => '')) === 'Bosniak 2019');
    // "Search copied text" searches what was copied (Electron 44 reads the
    // clipboard asynchronously; reading it the old way searched "[object Promise]").
    await app.evaluate(({ shell, clipboard }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; clipboard.writeText('bosniak IIF'); });
    await rg((r) => r.runAction('search:https://radiopaedia.org/search?q={clipboard}'));
    const opened = await waitFor(async () => (await app.evaluate(() => global.__opened)).find((u) => u.includes('radiopaedia')), 4000);
    check('Search copied text searches what was copied', opened === 'https://radiopaedia.org/search?q=bosniak%20IIF', String(opened));
    await win.click('#refOpen');
    const viewer = await waitFor(async () => app.windows().find((w) => w.url().includes('viewer')), 8000);
    if (viewer) await viewer.waitForFunction(() => window.__viewerReady === true, null, { timeout: 8000 }).catch(() => {});
    const vh = viewer ? await viewer.innerHTML('#page').catch(() => '') : '';
    check('the viewer shows a reference formatted', /<h1>Bosniak 2019<\/h1>/.test(vh) && /<strong>IIF<\/strong>/.test(vh), vh.slice(0, 120));
    if (viewer) {
      await viewer.screenshot({ path: path.join(SHOTS, 'reference-viewer.png') });
      await viewer.keyboard.press('Escape').catch(() => {}); // the window closes mid-press
      await sleep(400);
    }
    check('Esc closes the viewer', !app.windows().some((w) => w.url().includes('viewer')));

    // Proofread: the helper hands its results to the hub's window. Findings
    // come in a different order than they sit in the report, and one is not
    // in the text: every click must still land on its own mark.
    {
      const http = require('http');
      const ini = fs.readFileSync(path.join(userData, 'bridge.ini'), 'utf8');
      const port = Number(/Port=(\d+)/.exec(ini)[1]);
      const tok = /Token=(\S+)/.exec(ini)[1];
      const call = (method, p, body) => new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'X-RG-Token': tok } }, (res) => {
          let s = '';
          res.on('data', (c) => (s += c));
          res.on('end', () => resolve(s));
        });
        req.on('error', () => resolve(''));
        req.setTimeout(10000, () => { req.destroy(); resolve('(no answer in 10 s)'); });
        req.end(body || undefined);
      });
      // Invented report text (no patient data).
      const report = 'FINDINGS:\nThe left lobe has a 4 mm nodule.\nThe right lobe is clear.\nThere is no plural effusion.\n\nIMPRESSION:\nNo acute findings.';
      const flags = [
        { phrase: 'plural effusion', reason: 'Likely misheard word.', replacement: 'pleural effusion', advice: '' },
        { phrase: 'the hilum shows', reason: 'Not in the text.', replacement: '', advice: 'Check the dictation.' },
        { phrase: 'left lobe', reason: 'Lobe without upper / lower.', replacement: '', advice: 'Say which lobe.' },
      ];
      const shown = await call('POST', '/proofread', JSON.stringify({ seq: 7, report, flags }));
      check('the helper\'s proofread results open RadGesture\'s proofread window', shown === 'ok', shown);
      const pw = await waitFor(async () => app.windows().find((w) => w.url().includes('proofread')), 8000);
      if (pw) await pw.waitForSelector('.card[data-i="3"]', { timeout: 8000 }).catch(() => {});
      const marks = pw ? await pw.$$eval('mark', (ms) => ms.map((m) => m.dataset.i + ':' + m.textContent.replace(/\d+$/, ''))) : [];
      check('each finding is marked at its own place in the report', marks.join('|') === '3:left lobe|1:plural effusion', marks.join('|'));
      check('a finding not in the text says so', pw ? /Not found word for word/.test(await pw.textContent('.card[data-i="2"]')) : false);
      if (pw) await pw.click('.card[data-i="3"] .reason');
      const selMark = pw ? await pw.$eval('mark.sel', (m) => m.dataset.i).catch(() => '') : '';
      check('clicking finding 3 selects mark 3 in the report', selMark === '3', selMark);
      if (pw) await pw.click('mark[data-i="1"]');
      const selCard = pw ? await pw.$eval('.card.sel', (c) => c.dataset.i).catch(() => '') : '';
      check('clicking a mark selects its finding', selCard === '1', selCard);
      if (pw) await pw.keyboard.press('Space');
      const pill = pw ? await pw.textContent('#count') : '';
      check('Space ticks the finding off (count updates)', /2 to check . 1 resolved/.test(pill), pill);
      // Whatever earlier steps queued for the helper (none runs here).
      const drain = async () => { const got = []; for (let r = await call('GET', '/poll'); r.startsWith('action:'); r = await call('GET', '/poll')) got.push(r); return got; };
      await drain();
      if (pw) await pw.click('.card[data-i="1"] [data-act="find"]');
      // On Windows the real helper polls too and may take it first; then it
      // reports it done. Either way the helper got exactly this request.
      const reached = async (a) => {
        let got = [];
        const ok = await waitFor(async () => {
          got = got.concat(await drain());
          return got.includes('action:' + a) || (await rg((r) => r.events())).some((e) => `${e.type} ${e.detail}` === 'done ' + a);
        }, 3000);
        return { ok, got: got.join(' ') || '(taken by the helper)' };
      };
      const q1 = await reached('proof:find:7:1');
      check('Find asks the helper to find that finding in PowerScribe', q1.ok, q1.got);
      await call('POST', '/proofread-toast', 'Ready: Find What filled');
      const tst = pw ? await waitFor(async () => /Find What filled/.test(await pw.textContent('#toast')), 3000) : false;
      check('the helper\'s messages show in the window', !!tst);
      if (pw) await pw.screenshot({ path: path.join(SHOTS, 'proofread.png') });
      const stillOpen = pw && !pw.isClosed();
      check('the window stays open while you work in it', stillOpen);
      if (stillOpen) await pw.keyboard.press('Escape').catch(() => {}); // the window closes mid-press
      await sleep(500);
      const q2 = await reached('proof:closed:7:1');
      check('closing it tells the helper what was resolved (for the history)', q2.ok, q2.got);
      check('Esc closes the proofread window', !app.windows().some((w) => w.url().includes('proofread')));

      // Impression style: a finished report (as proofread sends it) becomes an
      // example, the next impression gets it back, and Settings shows it.
      const signed = 'EXAMINATION: CT CHEST WITHOUT CONTRAST\nHISTORY: Cough.\nFINDINGS:\nLungs: A 5 mm nodule in the right middle lobe. No consolidation.\nPleura: No effusion.\nIMPRESSION:\n1. No acute findings in the chest.\nElectronically signed by Dr. Invented Name 1/2/2026 10:00';
      const learned = await call('POST', '/style/learn', JSON.stringify({ source: 'proofread', draft: '', report: signed }));
      check('a proofread report becomes an impression example', learned === 'saved:1:CT chest', learned);
      const ex = await call('POST', '/style/examples', JSON.stringify({ report: 'EXAMINATION: CT CHEST\nFINDINGS:\nLungs: clear. No nodule.' }));
      check('Impression gets the closest example back, without the signer', /EXAMPLE 1 \(CT CHEST WITHOUT CONTRAST\)/.test(ex) && /No acute findings in the chest/.test(ex) && !/Invented|1\/2\/2026/.test(ex), ex.slice(0, 120));
      await win.click('#nav button[data-tab="ai"]');
      await win.waitForSelector('#styleCount', { timeout: 5000 }).catch(() => {});
      await sleep(300);
      check('Settings shows the example', /1 saved/.test(await win.textContent('#styleCount').catch(() => '')));
      await win.click('#stylePaste');
      await win.fill('#stylePasteText', 'EXAMINATION: US ABDOMEN RUQ\nFINDINGS:\nGallbladder: Shadowing gallstones, wall thickening and a positive sonographic Murphy sign.\nIMPRESSION:\nAcute calculous cholecystitis.\n\nEXAMINATION: MRI BRAIN\nFINDINGS:\nNo acute infarct, hemorrhage or mass. Ventricles normal for age.\nIMPRESSION:\nNo acute intracranial abnormality.');
      await win.click('#stylePasteAdd');
      await waitFor(async () => /3 saved/.test(await win.textContent('#styleCount').catch(() => '')), 5000);
      check('pasting reports adds one example each', /3 saved/.test(await win.textContent('#styleCount').catch(() => '')));
      await (await win.$('#styleCard')).screenshot({ path: path.join(SHOTS, 'settings-style.png') }).catch(() => {});

      // The helper's small windows, drawn by the hub: the toolbar, a result
      // card with a tick-off checklist, the one-liner picker and a toast.
      // Their buttons must reach the helper's queue.
      if (!process.env.RG_NO_PANELS && !process.env.RG_E2E_SKIP_PANELS) {
      const panel = (m) => waitFor(async () => app.windows().find((w) => w.url().includes('panel') && w.url().includes('mode=' + m)), 6000);
      const tbShown = await call('POST', '/ui', JSON.stringify({ t: 'toolbar', visible: true,
        priors: [{ peek: '3/14/2025  CT CHEST WITH CONTRAST' }, { peek: '1/5/2024  CT CHEST WITHOUT CONTRAST' }], chart: [{ peek: 'Oncology note: invented example, stage II.' }] }));
      check('the helper\'s toolbar opens in the hub', tbShown === 'ok', tbShown);
      const tbw = await panel('toolbar');
      if (tbw) await tbw.waitForSelector('#tbPriorAdd', { timeout: 5000 }).catch(() => {});
      const tbText = tbw ? await tbw.textContent('#shell').catch(() => '') : '';
      check('the toolbar lists each prior with its exam date', /P1\s*3\/14\/2025\s+CT CHEST WITH CONTRAST/.test(tbText) && /P2/.test(tbText) && /C1/.test(tbText), tbText.slice(0, 160));
      if (tbw) {
        await tbw.screenshot({ path: path.join(SHOTS, 'toolbar.png') }).catch(() => {});
        await tbw.click('#tbPriorAdd');
        const qa = await reached('prior:add');
        check('Add prior on the toolbar reaches the helper', qa.ok, qa.got);
        await tbw.click('.chip2:nth-child(2) .x');
        const qr = await reached('prior:remove:2');
        check('removing one prior reaches the helper', qr.ok, qr.got);
        await tbw.click('#tbCollapse');
        await sleep(300);
        check('the toolbar folds down to one row', !!(await tbw.$('.tbmini')));
        await tbw.screenshot({ path: path.join(SHOTS, 'toolbar-small.png') }).catch(() => {});
        await tbw.click('#tbCollapse');
      }
      const md = '- **RUL nodule**: 6 mm to 8 mm, compare size [P1 1/5/2024, P2 3/14/2025]\n- **Left adrenal nodule**: indeterminate, washout CT advised [P2 3/14/2025]\n- **Liver lesion (resolved)**: gone on P2; confirm still gone [P1 1/5/2024, P2 3/14/2025]';
      await call('POST', '/ui', JSON.stringify({ t: 'card', kind: 'checklist', icon: 'checklist', title: 'Check on: CT CHEST', sub: 'From 2 priors, oldest first: P2 (1/5/2024), P1 (3/14/2025)', checks: true, text: md, copy: md.replace(/\*\*/g, ''),
        buttons: [{ id: 'priorlist:insert', label: 'Insert into report', icon: 'input', primary: true, keep: true }, { id: 'copy', label: 'Copy', icon: 'content_copy' }, { id: 'prior:clear', label: 'Clear priors', icon: 'delete_sweep' }] }));
      const cw = await panel('card');
      if (cw) await cw.waitForSelector('.ck', { timeout: 5000 }).catch(() => {});
      const nItems = cw ? (await cw.$$('.ck')).length : 0;
      const tags = cw ? await cw.$$eval('.src', (e) => e.map((x) => x.textContent)) : [];
      check('the checklist card shows each item with its source tag', nItems === 3 && tags[1] === 'P2 3/14/2025' && !!(cw && await cw.$('.ckt strong')), `${nItems} items, tags ${tags.join(' | ')}`);
      if (cw) {
        await cw.click('button[data-id="priorlist:insert"]');
        const qi = await reached('priorlist:insert');
        await sleep(300);
        check('Insert reaches the helper and the card stays open for ticking', qi.ok && (await cw.evaluate(() => document.visibilityState === 'visible')), qi.got);
        await cw.click('.ck[data-i="0"]');
        await cw.click('.ck[data-i="1"]');
        check('ticking items counts them', /2 of 3 checked/.test(await cw.textContent('#clCount')));
        await cw.screenshot({ path: path.join(SHOTS, 'checklist-card.png') }).catch(() => {});
        await cw.click('.ck[data-i="2"]');
        check('all ticked says so', await cw.isVisible('.alldone.on'));
        await cw.click('button[data-id="copy"]');
        const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
        check('Copy takes the plain text, without the Markdown marks', copied.includes('RUL nodule: 6 mm') && !copied.includes('**'), copied.slice(0, 60));
      }
      await call('POST', '/ui', JSON.stringify({ t: 'card', kind: 'impression', icon: 'summarize', title: 'Impression', sub: 'Copied to the clipboard', text: 'No acute findings in the chest.',
        buttons: [{ id: 'imp:insert', label: 'Insert into report', icon: 'input', primary: true }, { id: 'copy', label: 'Copy', icon: 'content_copy' }, { id: 'imp:oe', label: 'OpenEvidence', icon: 'open_in_new', keep: true }] }));
      await sleep(600);
      if (cw) await cw.screenshot({ path: path.join(SHOTS, 'impression-card.png') }).catch(() => {});
      await call('POST', '/ui', JSON.stringify({ t: 'pick', title: 'One-liner', sub: 'From the copied text', cancel: 'pick:cancel', options: [
        { id: 'pick:full', label: 'Full medical one-liner', hint: 'History and surgeries in one line', icon: 'notes' },
        { id: 'pick:oncologic', label: 'Oncologic history', hint: 'Cancers, staging, treatment, current status', icon: 'oncology' }] }));
      const pkw = await panel('pick');
      if (pkw) {
        await pkw.waitForSelector('.opt', { timeout: 5000 }).catch(() => {});
        await pkw.screenshot({ path: path.join(SHOTS, 'picker.png') }).catch(() => {});
        await pkw.keyboard.press('2');
        const qp = await reached('pick:oncologic');
        check('pressing 2 in the picker picks the second kind', qp.ok, qp.got);
      } else check('the one-liner picker opens in the hub', false);
      const ts = await call('POST', '/ui', JSON.stringify({ t: 'toast', text: 'Learned (CT chest). 3 examples of your impressions.', kind: 'ok', ms: 4000 }));
      const tw = await panel('toast');
      if (tw) { await tw.waitForSelector('.tst', { timeout: 4000 }).catch(() => {}); await tw.screenshot({ path: path.join(SHOTS, 'toast.png') }).catch(() => {}); }
      check('a toast shows in the hub', ts === 'ok' && !!tw);
      await call('POST', '/ui', JSON.stringify({ t: 'toolbar', visible: false }));
      await call('POST', '/ui', JSON.stringify({ t: 'card-close' }));
      await call('POST', '/ui', JSON.stringify({ t: 'toast-hide' }));
      }
    }

    // The ring editor offers Library functions, with the key note.
    await win.click('#nav button[data-tab="rings"]');
    await sleep(300);
    await win.click('.rings .card:first-child .lrow:has-text("PACS")');
    await sleep(200);
    // The ring picture: no name runs over a button, and all of it stays in its card.
    const miniHits = await win.evaluate(() => {
      const box = document.querySelector('.mini');
      const card = box.closest('.card').getBoundingClientRect();
      const r = (e) => e.getBoundingClientRect();
      const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const names = [...box.querySelectorAll('.t')], buttons = [...box.querySelectorAll('.n, .c')];
      const out = [];
      for (const t of names) {
        for (const b of buttons) if (meet(r(t), r(b))) out.push(`${t.textContent} on ${b.title || 'center'}`);
        const tr = r(t);
        if (tr.left < card.left || tr.right > card.right) out.push(`${t.textContent} outside its card`);
      }
      return { names: names.length, dirs: box.querySelectorAll('.n:not(.back)').length, out };
    });
    await (await win.$('.mini')).screenshot({ path: path.join(SHOTS, 'settings-ring-picture.png') }).catch(() => {});
    check('the ring picture keeps every name clear of the buttons', miniHits.names >= 7 && miniHits.names === miniHits.dirs && !miniHits.out.length, miniHits.out.join('; ') || `${miniHits.names} names for ${miniHits.dirs} directions`);
    await win.click('.rings .card:nth-child(2) .lrow:has-text("Insert priors")');
    await sleep(200);
    check('a PACS direction is a Function in the ring editor', (await win.$eval('#libPick', (e) => e.value)) === 'PACS_Insert_Priors');
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
    const lastCat = (await ringPage.$$('.dchip[data-cat]')).length - 1;
    await (await ringPage.$(`.dchip[data-cat="${lastCat}"]`)).click();
    await sleep(400);
    check('the ring draws a picture icon', (await ringPage.$$('.node img.imgic')).length > 0);
    await ringPage.screenshot({ path: path.join(SHOTS, 'ring-picture-icon.png') });
    // Previous / next keep the ring open: PACS > Layout > Next layout runs
    // (queued for the helper marked "keep|") and the ring stays up for the next click.
    {
      const labels = () => ringPage.evaluate(() => { const boxes = document.querySelectorAll('.nodes'); const b = boxes[boxes.length - 1]; return [...b.querySelectorAll('.label')].map((l) => l.textContent); });
      const clickNamed = async (name) => {
        const i = (await labels()).indexOf(name);
        if (i < 0) return false;
        await sleep(350); // let the springs settle where they will stay
        const r = await ringPage.evaluate((k) => { const boxes = document.querySelectorAll('.nodes'); const b = boxes[boxes.length - 1].querySelector(`.node[data-slot="${k}"]`).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, i);
        await ringPage.mouse.move(r.x, r.y, { steps: 4 });
        await sleep(150);
        await ringPage.mouse.click(r.x, r.y);
        return true;
      };
      const nChips = (await ringPage.$$('.dchip[data-cat]')).length;
      for (let c = 0; c < nChips && !(await labels()).includes('Layout'); c++) {
        await (await ringPage.$(`.dchip[data-cat="${c}"]`)).click();
        await sleep(450);
      }
      const opened = await clickNamed('Layout');
      await sleep(500);
      const clicked = opened && await clickNamed('Next layout');
      await sleep(500);
      const q = await rg((r) => r.queue());
      const still = await ringPage.evaluate(() => !!window.RGRing.state());
      // Queued marked "keep|"; on Windows the real helper may already have run it.
      const ran = q.includes('keep|lib:PACS_Next_Layout') || (WIN && (await rg((r) => r.events())).some((e) => `${e.type} ${e.detail}` === 'done lib:PACS_Next_Layout'));
      check('Next layout runs and the ring stays open for the next click', clicked && still && ran, `clicked=${clicked} open=${still} queue=${q.join(',')}`);
      await ringPage.screenshot({ path: path.join(SHOTS, 'ring-keep-open.png') });
      check('the Image ring holds MPR, Thick slab, Slab off, Invert, Enhance, Sharpen, Reset', await (async () => {
        await ringPage.evaluate(() => window.RGRing.clear());
        await rg((r) => r.openRing('click'));
        await sleep(500);
        for (let c = 0; c < nChips && !(await labels()).includes('Image'); c++) { await (await ringPage.$(`.dchip[data-cat="${c}"]`)).click(); await sleep(450); }
        await clickNamed('Image');
        await sleep(500);
        return (await labels()).join('|') === 'MPR|Thick slab|Slab off|Invert|Enhance|Sharpen|Reset';
      })(), (await labels()).join('|'));
      await ringPage.screenshot({ path: path.join(SHOTS, 'ring-image.png') });
    }
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
      const notepads = () => { try { return (execFileSync('tasklist', ['/FI', 'IMAGENAME eq notepad.exe'], { timeout: 15000 }).toString().match(/notepad\.exe/gi) || []).length; } catch (_) { return -1; } };
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
      try { execFileSync('taskkill', ['/F', '/IM', 'notepad.exe'], { timeout: 15000 }); } catch (_) {}

      // Library: from the ring (as Try it does) and from its own keyboard
      // shortcut, recorded above, pressed for real by a second script.
      if (myId) {
        await runVia('lib:' + myId);
        check('My functions: a function you wrote runs (bundled AutoHotkey)', await waitFor(() => fs.existsSync(marker), 10000), (await ev()).slice(-4).join(' | '));
      }
      await runVia('lib:LoginForget');
      check('a Function runs in the helper', await waitFor(async () => (await ev()).some((e) => e === 'done lib:LoginForget'), 8000));
      // The shipped shortcuts (Rad Optimizer's keys) are on from the first
      // start, with nothing set up: the helper says how many, and a real
      // Ctrl+Alt+2 reaches "Lung window".
      const wanted = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'library.json'), 'utf8')).functions.filter((f) => f.on && f.hotkey).length;
      const reported = (await ev()).map((e) => /^done lib-hotkeys:(\d+):(.*)$/.exec(e)).filter(Boolean).pop();
      check('the helper switched on every shipped function shortcut', reported && Number(reported[1]) >= wanted && !reported[2], reported ? reported[0] : 'no report');
      if (process.env.AHK_EXE) {
        const press2 = path.join(userData, 'press-ctrl-alt-2.ahk');
        fs.writeFileSync(press2, '#NoTrayIcon\r\nSendLevel, 1\r\nSend, ^!2\r\nExitApp\r\n');
        spawnSync(process.env.AHK_EXE, [press2], { timeout: 15000 });
        check('a shipped shortcut works out of the box (Ctrl+Alt+2 = Lung window)', await waitFor(async () => (await ev()).some((e) => e === 'done lib-key:PACS_WL_Lung'), 8000), (await ev()).slice(-6).join(' | '));
      }
      if (process.env.AHK_EXE) {
        const pressFile = path.join(userData, 'press-lib.ahk');
        fs.writeFileSync(pressFile, '#NoTrayIcon\r\nSendLevel, 1\r\nSend, ^!+{F9}\r\nExitApp\r\n');
        spawnSync(process.env.AHK_EXE, [pressFile], { timeout: 15000 });
        check('a function\'s keyboard shortcut runs it', await waitFor(async () => (await ev()).some((e) => e === 'done lib-key:LoginForget'), 8000), (await ev()).slice(-6).join(' | '));
        // Copying the highlighted text from inside a shortcut (Paste indication
        // and Search selection share it): highlight text in Notepad, press
        // Alt+Shift+S the way a mouse button or macro pad does, and read what
        // RadGesture's Search window says it copied.
        const copyOut = path.join(userData, 'copy-result.txt');
        const copyAhk = path.join(userData, 'press-search.ahk');
        fs.writeFileSync(copyAhk, [
          '#NoTrayIcon', 'SetTitleMatchMode, 2',
          'Run, notepad.exe', 'WinWait, ahk_exe notepad.exe, , 8', 'WinActivate', 'WinWaitActive, ahk_exe notepad.exe, , 5',
          'Sleep, 500', 'SendInput, bosniak IIF cyst', 'Sleep, 200', 'SendInput, ^a', 'Sleep, 300',
          'SendLevel, 1', 'Send, {Alt down}{Shift down}s', 'Sleep, 150', 'Send, {Shift up}{Alt up}',
          'WinWait, Search ahk_class AutoHotkeyGUI, , 8',
          'if ErrorLevel', '  FileAppend, NO WINDOW, ' + copyOut, 'else {', '  ControlGetText, t, Static1, Search ahk_class AutoHotkeyGUI', '  FileAppend, %t%, ' + copyOut, '  WinClose, Search ahk_class AutoHotkeyGUI', '}',
          'ExitApp', ''].join('\r\n'));
        spawnSync(process.env.AHK_EXE, [copyAhk], { timeout: 30000 });
        const copied = fs.existsSync(copyOut) ? fs.readFileSync(copyOut, 'utf8') : 'nothing';
        check('a shortcut copies the highlighted text (as Paste indication does)', /bosniak IIF cyst/.test(copied), copied);
        try { execFileSync('taskkill', ['/F', '/IM', 'notepad.exe'], { timeout: 15000 }); } catch (_) {}

        // A Sectra function from a macro pad: Ctrl+Alt+M is still held when
        // the helper presses Alt+M in the image window. A stand-in "Image
        // Window" writes down the key it gets, with the modifiers held then:
        // it must be Alt+M, not Ctrl+Alt+M.
        const keyOut = path.join(userData, 'sectra-key.txt');
        try { fs.unlinkSync(keyOut); } catch (_) {}
        const fakeSectra = path.join(userData, 'fake-sectra.ahk');
        fs.writeFileSync(fakeSectra, [
          '#NoTrayIcon', '#SingleInstance Force', 'SetTitleMatchMode, 2',
          'Gui, Add, Edit, w300 h60 vBox',
          'Gui, Show, w320 h80, Image Window - test',
          'OnMessage(0x100, "Key")', 'OnMessage(0x104, "Key")',
          'Run, notepad.exe', 'WinWait, ahk_exe notepad.exe, , 8', 'WinActivate', 'WinWaitActive, ahk_exe notepad.exe, , 5', 'Sleep, 400',
          'SendLevel, 1', 'Send, {Ctrl down}{Alt down}m', 'Sleep, 600', 'Send, {Alt up}{Ctrl up}', 'SendLevel, 0',
          'Sleep, 1200', 'FileAppend, end, ' + keyOut, 'ExitApp',
          'Key(wParam) {',
          '  if (wParam = 0x4D)',
          '    FileAppend, % (GetKeyState("Ctrl") ? "ctrl+" : "") . (GetKeyState("Alt") ? "alt+" : "") . "m|", ' + keyOut,
          '}', ''].join('\r\n'));
        spawnSync(process.env.AHK_EXE, [fakeSectra], { timeout: 30000 });
        const gotKey = fs.existsSync(keyOut) ? fs.readFileSync(keyOut, 'utf8') : 'nothing';
        check('a Sectra function from a held Ctrl+Alt+M presses plain Alt+M in the image window (Insert measurement)', /^alt\+m\|/.test(gotKey), gotKey);
        try { execFileSync('taskkill', ['/F', '/IM', 'notepad.exe'], { timeout: 15000 }); } catch (_) {}

        // The one-liner's chart bin and the prior checklist, on the hub's
        // toolbar (the helper says what it shows over /ui). Nothing is
        // highlighted, so Add takes what was copied.
        const binText = async () => {
          const w = app.windows().find((x) => x.url().includes('panel') && x.url().includes('mode=toolbar'));
          return w ? await w.textContent('#shell').catch(() => '') : '(no toolbar window)';
        };
        for (const piece of ['Oncology note: invented example, stage II, started chemo.', 'Path report: invented example, margins negative.']) {
          await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), piece);
          await runVia('chart:add');
          await waitFor(async () => (await ev()).filter((e) => e === 'done chart:add').length >= 1, 5000);
          await sleep(500);
        }
        await waitFor(async () => /C2/.test(await binText()), 4000);
        const bin2 = await binText();
        check('the one-liner chart bin collects copied pieces (toolbar shows C1, C2)', /C1\s*Oncology note/.test(bin2) && /C2\s*Path report/.test(bin2), bin2.replace(/\s+/g, ' ').slice(0, 200));
        await runVia('chart:clear');
        await sleep(800);
        check('Empty chart text empties it', /Highlight parts of the chart/.test(await binText()));
        // A prior with its exam date at the top: the toolbar shows the date
        // (read by the helper's PriorDate) and the exam (PriorTitle).
        await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), 'Exam date: 03/14/2025\r\nEXAMINATION: CT CHEST WITH CONTRAST\r\nFINDINGS: invented prior report: 6 mm nodule right upper lobe, follow-up advised.\r\nIMPRESSION: Nodule.');
        await runVia('prior:add');
        await waitFor(async () => /P1/.test(await binText()), 4000);
        const bin3 = await binText();
        check('Add prior shows it on the toolbar with its exam date', /P1\s*3\/14\/2025\s+CT CHEST WITH CONTRAST/.test(bin3), bin3.replace(/\s+/g, ' ').slice(0, 200));
        await runVia('prior:clear');
        await sleep(800);
        check('Empty the list empties the prior checklist', /Highlight a prior report/.test(await binText()));
        // Proofread through the REAL helper path (ShowProofreadPopup ->
        // ProofreadToHub -> /proofread): an invented report with a tab, x, mu,
        // an em dash and curly quotes must open RadGesture's window, not the
        // helper's old fallback window.
        await runVia('proof:demo');
        await waitFor(async () => (await ev()).some((e) => e === 'proofread 2 findings' || e.startsWith('done proof-fallback')), 15000);
        const pev = (await ev()).filter((e) => /proof/.test(e));
        check('the helper\'s own proofread opens RadGesture\'s window (not the old one)', pev.includes('proofread 2 findings') && !pev.some((e) => e.startsWith('done proof-fallback')), pev.join(' | '));
        const pwin = await waitFor(async () => app.windows().find((w) => w.url().includes('proofread')), 6000);
        let ptext = '';
        if (pwin) await waitFor(async () => /EXAMINATION/.test(ptext = await pwin.textContent('body').catch(() => '')), 6000);
        check('the report arrives intact (x, mu, dash, quotes)', /6 \u00d7 4 mm/.test(ptext) && /\u00b5Ci/.test(ptext) && /\u2014/.test(ptext) && /\u201cStable\u201d/.test(ptext), ptext.replace(/\s+/g, ' ').slice(0, 160));
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('proofread')).forEach((w) => w.close()));
        await sleep(600);
        // The same from RadGesture's tray (the helper has no tray icon of its own).
        await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), 'MR BRAIN, invented prior report: no acute findings.');
        await rg((r) => r.clickTray('Prior checklist > Add copied prior'));
        check('tray > Prior checklist > Add copied prior reaches the helper (P1 on the toolbar)', await waitFor(async () => /P1\s*MR BRAIN/.test(await binText()), 6000), (await binText()).replace(/\s+/g, ' ').slice(0, 160));
        await rg((r) => r.clickTray('Prior checklist > Empty the list'));
        await sleep(800);
      }

      const ahk = process.env.AHK_EXE;
      if (ahk && connected) {
        const inject = (mode) => spawnSync(ahk, [path.join(__dirname, 'inject.ahk'), mode], { timeout: 20000 });
        inject('flick');
        const flick = await waitFor(async () => (await ev()).some((e) => e.startsWith('done keys:{F13}')), 10000);
        if (!flick) {
          // What is on screen when the ring does not answer.
          const scene = await app.evaluate(async ({ BrowserWindow, screen }) => ({
            cursor: screen.getCursorScreenPoint(),
            windows: BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL().split('/').slice(-2).join('/'), visible: w.isVisible(), top: w.isAlwaysOnTop(), focused: w.isFocused(), bounds: w.getBounds() })),
          }));
          console.log('  [debug] ' + JSON.stringify(scene));
          const ov = app.windows().find((w) => w.url().includes('renderer'));
          if (ov) console.log('  [debug] ring ' + JSON.stringify(await ov.evaluate(() => { const s = window.RGRing.state(); return s && { levels: s.levels.length, hover: s.hover, cat: s.cat, mode: s.mode }; }).catch((e) => String(e))));
        }
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
    // Never wait forever for the app to quit: a RadGesture that stays running
    // also kept the CI step open with no log.
    const quit = await Promise.race([app.close().then(() => true, () => true), sleep(15000).then(() => false)]);
    check('RadGesture quits when asked (within 15 s)', quit);
    if (!quit) {
      try { app.process().kill(); } catch (_) {}
      if (WIN) for (const im of ['RadGesture.exe', 'RadGestureHelper.exe']) try { execFileSync('taskkill', ['/F', '/T', '/IM', im], { timeout: 15000 }); } catch (_) {}
    }
    if (WIN && helperPid) {
      await sleep(1500);
      let alive = false;
      try { alive = execFileSync('tasklist', ['/FI', `PID eq ${helperPid}`], { timeout: 15000 }).toString().includes(String(helperPid)); } catch (_) {}
      check('quitting RadGesture also stops the helper', !alive);
    }
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  // Nothing left behind to hold the CI step open.
  if (WIN) for (const im of ['notepad.exe', 'RadGesture.exe', 'RadGestureHelper.exe']) try { execFileSync('taskkill', ['/F', '/T', '/IM', im], { timeout: 15000, stdio: 'ignore' }); } catch (_) {}
  process.exit(failed.length ? 1 : 0);
})();
