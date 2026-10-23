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
  // Ring-button bar vs the directions on screen: names of any that overlap it.
  const dockOverlaps = () => page.evaluate(() => {
    const bar = document.querySelector('.dock .dchips');
    if (!bar || getComputedStyle(bar.parentElement).opacity === '0') return [];
    const b = bar.getBoundingClientRect();
    return [...document.querySelectorAll('.node')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    }).map((n) => n.textContent);
  });

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
  await page.waitForTimeout(250);
  assert.deepStrictEqual(await dockOverlaps(), [], 'the ring buttons stay clear of a smaller ring opened down-right');
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

  // 5. Last ring (Apps), and a phone-sized view.
  await page.keyboard.press('Escape');
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.mouse.wheel(0, -120); // backwards wraps round to the last ring
  assert.strictEqual((await state()).cat, 3, 'scrolling back from the first ring wraps to the last');
  await page.mouse.move(cx + 2, cy - 90);
  await shot('5-last-ring');

  // 6. The dock: one click jumps straight to a ring (Gallery is the 3rd).
  const chip = await page.$('.dchip[data-cat="2"]');
  assert.ok(chip, 'the dock shows a button per ring');
  const cb = await chip.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down(); await page.mouse.up();
  assert.strictEqual((await state()).cat, 2, 'clicking a dock button jumps straight to that ring');
  await shot('6-dock-jump');

  // 7. Drag the middle: the ring moves and stays open on the same ring.
  const before = await page.evaluate(() => ({ x: window.RGRing.state().x, y: window.RGRing.state().y }));
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x - 260, before.y - 120, { steps: 12 });
  await page.mouse.up();
  const after = await page.evaluate(() => { const s = window.RGRing.state(); return s && { x: s.x, y: s.y, cat: s.cat }; });
  assert.ok(after && Math.abs(after.x - (before.x - 260)) < 2 && Math.abs(after.y - (before.y - 120)) < 2, 'dragging the middle moves the ring');
  assert.strictEqual(after.cat, 2, 'a drag does not switch rings');
  await page.mouse.move(after.x + 60, after.y - 90);
  await shot('7-dragged');
  // A plain click on the middle still switches; right-click goes back.
  await page.mouse.move(after.x, after.y); await page.mouse.down();
  await page.mouse.up();
  assert.strictEqual((await state()).cat, 3, 'clicking the middle still goes to the next ring');
  await page.mouse.click(after.x, after.y, { button: 'right' });
  assert.strictEqual((await state()).cat, 2, 'right-clicking the middle goes to the previous ring');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(195, 470); await page.mouse.down(); await page.mouse.up();
  await page.mouse.move(150, 380);
  await shot('8-phone');

  // 8b. Ring left open after a tap: moving past a direction that holds more
  // opens it (Sina's default); with passOpens off it waits for a click.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  for (const on of [true, false]) {
    await page.evaluate((v) => { if (v) delete window.RG_DEMO_MENU.passOpens; else window.RG_DEMO_MENU.passOpens = false; }, on);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
    assert.strictEqual((await state()).mode, 'click');
    await page.mouse.move(cx + 110, cy + 150, { steps: 8 }); // past One-liner (down-right)
    await page.waitForTimeout(300);
    assert.strictEqual((await state()).levels, on ? 2 : 1, on ? 'after a tap, moving past One-liner opens its smaller ring' : 'with the switch off it does not');
    if (on) await shot('8b-pass-after-tap');
    if (on) { await page.waitForTimeout(250); assert.deepStrictEqual(await dockOverlaps(), [], 'ring buttons clear of the opened ring'); }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { delete window.RG_DEMO_MENU.passOpens; });

  // 9. Every theme, aimed at Impression, with the dock showing.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  const themes = await page.evaluate(() => window.RGThemes.THEMES.map((t) => t.id));
  for (const id of themes) {
    await page.evaluate((t) => { window.RG_DEMO_MENU.theme = t; }, id);
    await page.waitForTimeout(250);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
    await page.mouse.move(cx + 80, cy - 26);
    assert.strictEqual(await page.evaluate(() => document.getElementById('stage').dataset.theme), id, `theme ${id} is applied`);
    await shot('9-theme-' + id);
    await page.keyboard.press('Escape');
  }

  // 10. The gear at the end of the dock opens Settings.
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500); // the bar springs into place
  const gear = await page.$('.dock .dset');
  assert.ok(gear, 'the dock has a Settings button');
  const gb = await gear.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 3 });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => document.querySelector('.dock .dname').textContent), 'Settings', 'its name shows on hover');
  await shot('10-dock-settings');
  const picked = await page.evaluate(() => new Promise((res) => { window.RGRing.hooks.select = (it) => res(it.action); document.querySelector('.dock .dset').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 })); setTimeout(() => res(null), 1000); }));
  assert.strictEqual(picked, 'hub:settings', 'the gear opens Settings');

  // 11. PACS > Layout > Grid: the fixed layouts, drawn as "2×2" etc.
  await page.evaluate(() => window.RGRing.clear());
  for (let i = 0; i < 5 && !(await state()); i++) {
    await page.waitForTimeout(300);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  }
  await page.waitForTimeout(400);
  assert.ok(await state(), 'the ring is open again');
  const pacsAt = await page.evaluate(() => window.RG_DEMO_MENU.categories.findIndex((c) => c.id === 'pacs'));
  const pc = await (await page.$(`.dchip[data-cat="${pacsAt}"]`)).boundingBox();
  await page.mouse.click(pc.x + pc.width / 2, pc.y + pc.height / 2);
  await page.waitForTimeout(400);
  const clickNode = async (name) => {
    const box = await page.evaluate((n) => {
      const L = window.RGRing.state().levels.slice(-1)[0];
      const N = L.nodes.find((x) => x.it.name === n);
      const r = N && N.el.getBoundingClientRect();
      return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    assert.ok(box, `"${name}" is on the ring`);
    await page.mouse.move(box.x, box.y); // straight there: gliding past a direction would open it
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(450);
  };
  await clickNode('Layout');
  await clickNode('Grid');
  const gridIcons = await page.evaluate(() => window.RGRing.state().levels.slice(-1)[0].nodes.filter((N) => !N.back).map((N) => N.el.querySelectorAll('.gridic rect').length));
  assert.deepStrictEqual(gridIcons, [4, 6, 9], 'the Grid ring draws every layout as panes');
  await page.mouse.move(cx + 140, cy - 20);
  await shot('11-layout-grid');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('PASS preview flows; screenshots in scripts/shots/');
})().catch((e) => { console.error("FAIL", e.stack); process.exit(1); });
