// Drives the preview page in headless Chromium and saves screenshots, so the
// ring's look can be checked without Windows. Also asserts the basic flows.
//   node scripts/build-preview.js && node scripts/preview.js
const path = require('path');
const assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(path.join(process.env.NODE_TOOLS || '/home/user/node-tools/node_modules', 'playwright'))); }

const page_ = 'file://' + path.join(__dirname, '..', 'dist-preview', 'RadGesture-preview.html');
const shots = path.join(__dirname, 'shots');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(page_);
  const shot = async (n) => { await page.waitForTimeout(380); return page.screenshot({ path: path.join(shots, n + '.png') }); };
  const state = () => page.evaluate(() => { const s = window.RGRing.state(); return s && { levels: s.levels.length, hover: s.hover, cat: s.cat, mode: s.mode }; });
  const toast = () => page.evaluate(() => document.getElementById('toast').textContent);
  const cx = 640, cy = 420;

  // 1. Hold and aim at Impression (2nd item, about 72 degrees clockwise from up).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy - 26, { steps: 6 });
  let s = await state();
  assert.strictEqual(s.hover, 1, 'aiming right-up should light Impression');
  await shot('1-hold-impression');
  await page.mouse.up();
  assert.match(await toast(), /Impression/);
  assert.strictEqual(await state(), null, 'ring closes after a flick');

  // 2. Flick through One-liner (3rd item, ~144 deg: down-right) into its sub-ring.
  await page.waitForTimeout(400);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 150, { steps: 10 });
  s = await state();
  assert.strictEqual(s.levels, 2, 'moving past One-liner opens its smaller ring');
  await page.mouse.move(cx + 110 + 60, cy + 150 + 40, { steps: 5 });
  await shot('2-oneliner-subring');
  await page.mouse.up();
  assert.match(await toast(), /\w/);

  // 3. Tap = stays open, then scroll to Gallery and screenshot.
  await page.waitForTimeout(400);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  s = await state();
  assert.ok(s && s.mode === 'click', 'a tap leaves the ring open for clicking');
  await page.mouse.wheel(0, 120);
  s = await state();
  assert.strictEqual(s.cat, 1, 'scroll switches to PACS');
  await page.mouse.move(cx + 70, cy - 70);
  await shot('3a-pacs');
  await page.mouse.wheel(0, 120);
  s = await state();
  assert.strictEqual(s.cat, 2, 'scroll again: Gallery');
  await page.mouse.move(cx - 60, cy - 100);
  await shot('3-gallery-click-mode');

  // 4. Click Abdomen/Pelvis (2nd gallery item) to open its ring.
  await page.mouse.move(cx + 100, cy - 60);
  await page.mouse.down(); await page.mouse.up();
  s = await state();
  assert.strictEqual(s.levels, 2, 'clicking a section opens its smaller ring');
  await page.mouse.move(cx + 140, cy - 160);
  await shot('4-gallery-abdomen');

  // 5. Stopwatch ring, and a phone-sized view.
  await page.keyboard.press('Escape');
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.mouse.wheel(0, -120); // backwards wraps round to Stopwatch
  assert.strictEqual((await state()).cat, 4, 'scrolling back from the first ring wraps to Stopwatch');
  await page.mouse.move(cx + 2, cy - 90);
  await shot('5-stopwatch');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(195, 470); await page.mouse.down(); await page.mouse.up();
  await page.mouse.move(150, 380);
  await shot('6-phone');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('PASS preview flows; screenshots in scripts/shots/');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
