// The ring. Every element stays alive while the ring is open and is moved each
// frame by spring physics, so the menu reacts continuously to the pointer:
//
//  - the pointer on the center's rim follows the cursor;
//  - directions zoom in the closer you aim at them, the aimed one most;
//  - in a flick, the aimed direction stretches out after your hand, and moving
//    past one with a smaller ring opens that ring right there;
//  - smaller rings grow out of the direction you chose, the way back is the
//    small node pointing at where you came from;
//  - the center switches rings (click or scroll) with a spin, and the dock of
//    ring icons under it jumps straight to any ring in one click;
//  - dragging the center moves the whole ring out of the way.
//
// Two ways to use it: flick (hold the trigger, move, let go) or tap the
// trigger and click. Public API (used by the hub, the preview and the tests):
//   RGRing.open({x, y, menu, category, mode}), RGRing.release(), RGRing.clear(),
//   RGRing.hooks.select/dismiss, RGRing.state()

(function () {
  const G = window.RGGeometry;
  const I = window.RGIcons;
  const T = window.RGThemes;

  const R_ROOT = 120; // direction distance from the center
  const R_SUB = 104;
  const DEAD = 30; // aiming starts this far from the center
  const PASS = 30; // move this far past a direction to open its smaller ring
  const TAP_MS = 320; // released sooner = a tap: stay open for clicking
  const EDGE = 190; // keep the ring this far from the screen edge
  const LABEL_PAUSE_MS = 650; // labels fade in after this long without a choice
  const DRAG_PX = 6; // the center moves this far under a pressed button = a drag, not a click
  const DOCK_SETTINGS = -2; // dockHover while on the gear
  const DOCK_GAP = 104; // dock sits this far past the directions (unscaled)
  const PASS_DWELL_MS = 120; // ring left open (after a tap): stay past a direction this long to open it

  const stage = document.getElementById('stage');
  const hooks = { select() {}, dismiss() {} };
  let st = null;
  let raf = 0;
  let lastT = 0;
  let svgSeq = 0;

  // ------------------------------------------------------------ springs

  // Slightly under-damped: a touch of overshoot is what makes it feel alive.
  function spring(x, k = 380, d = 26) {
    return { x, v: 0, t: x, k, d };
  }
  function step(s, dt) {
    const f = -s.k * (s.x - s.t) - s.d * s.v;
    s.v += f * dt;
    s.x += s.v * dt;
  }
  function settled(s) {
    return Math.abs(s.x - s.t) < 0.002 && Math.abs(s.v) < 0.01;
  }
  function snap(s, x) {
    s.x = s.t = x;
    s.v = 0;
  }

  // ------------------------------------------------------------ helpers

  const cur = () => st.levels[st.levels.length - 1];
  const category = () => st.menu.categories[st.cat];
  const el = (cls, html, parent) => {
    const e = document.createElement('div');
    e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  function labelMode() {
    const m = st.menu;
    if (m.labels) return m.labels; // 'always' | 'pause' | 'never'
    if (m.showLabels === false) return 'never';
    return 'pause';
  }

  function sector(a, half, r0, r1) {
    const p = (ang, r) => G.polar(0, 0, ang, r);
    const large = half * 2 > 180 ? 1 : 0;
    const o0 = p(a - half, r1), o1 = p(a + half, r1), i1 = p(a + half, r0), i0 = p(a - half, r0);
    return `M${o0.x},${o0.y} A${r1},${r1} 0 ${large} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${r0},${r0} 0 ${large} 0 ${i0.x},${i0.y} Z`;
  }

  // ------------------------------------------------------------ building

  function buildLevel(L, fromNode) {
    const layer = el('layer');
    L.layer = layer;
    L.halo = el('halo', undefined, layer);

    L.wedgeSvg = svgEl('svg', { class: 'wedges', width: 1, height: 1 }, layer);
    const defs = svgEl('defs', {}, L.wedgeSvg);
    // Ids are per level: a url(#id) shared by two levels would resolve to the
    // first one's gradient, sized for the other ring.
    const uid = 'L' + (++svgSeq);
    const grad = svgEl('radialGradient', { id: uid + 'hl', cx: 0, cy: 0, r: L.r + 60, gradientUnits: 'userSpaceOnUse' }, defs);
    svgEl('stop', { offset: '0.35', 'stop-color': catColor(st.cat), 'stop-opacity': '0.0' }, grad);
    svgEl('stop', { offset: '0.75', 'stop-color': catColor(st.cat), 'stop-opacity': '0.28' }, grad);
    svgEl('stop', { offset: '1', 'stop-color': catColor(st.cat), 'stop-opacity': '0.0' }, grad);
    // Soft edges on the highlight, and separators that fade out at both ends
    // instead of stopping dead.
    const soft = svgEl('filter', { id: uid + 'soft', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: '5' }, soft);
    const end = L.r + 42;
    const sg = svgEl('radialGradient', { id: uid + 'sep', cx: 0, cy: 0, r: end, gradientUnits: 'userSpaceOnUse' }, defs);
    [[66 / end, 0], [(66 / end + 1) / 2, 1], [1, 0]].forEach(([o, a]) =>
      svgEl('stop', { offset: String(o), class: 'sepstop', 'stop-opacity': String(a) }, sg));
    L.seps = svgEl('g', { stroke: `url(#${uid}sep)` }, L.wedgeSvg);
    L.hlPath = svgEl('path', { class: 'hl', d: '', fill: `url(#${uid}hl)`, filter: `url(#${uid}soft)` }, L.wedgeSvg);

    L.center = el('center', undefined, layer);
    L.center.dataset.center = '1';
    L.cIcon = el('cicon', I.icon(L.icon || category().icon || 'circle'), L.center);
    L.cText = el('ctext', '<div class="ctitle"></div>', L.center);
    L.cTitle = L.cText.firstChild;
    if (!L.sub) {
      L.cName = el('cname', escapeHtml(category().name), L.center);
      if (st.menu.categories.length > 1 && st.menu.dock === false) {
        L.cDots = el('ccat', st.menu.categories.map((_, i) => `<i class="${i === st.cat ? 'on' : ''}"></i>`).join(''), L.center);
      }
    } else {
      L.cName = el('cname', escapeHtml(L.name), L.center);
    }
    L.rim = el('rim', undefined, layer);
    L.nodeBox = el('nodes', undefined, layer);

    L.cScale = spring(fromNode ? 0.52 : 0.6, 420, 24);
    L.cScale.t = 1;
    L.op = spring(0, 400, 30);
    L.op.t = 1;
    L.ox = spring(0, 360, 28);
    L.oy = spring(0, 360, 28);
    if (fromNode) {
      L.ox.x = fromNode.x - L.cx;
      L.oy.x = fromNode.y - L.cy;
    }
    L.iconOp = spring(1, 500, 34);
    L.textOp = spring(0, 500, 34);
    L.rimOp = spring(0, 500, 34);
    L.rimA = spring(0, 300, 26);
    L.hlOp = spring(0, 500, 34);
    L.hlA = spring(0, 420, 30); // the highlight glides to the aimed direction
    L.hlHalf = 0;
    L.hlDrawn = null;
    L.spin = spring(0, 220, 22);

    buildNodes(L);
    // Placed now, not on the next frame, so it is never hit-tested at 0,0.
    layer.style.transform = `translate(${L.cx + L.ox.x}px, ${L.cy + L.oy.x}px) scale(${st.s})`;
    stage.appendChild(layer);
  }

  function buildNodes(L) {
    L.nodeBox.innerHTML = '';
    L.seps.innerHTML = '';
    L.nodes = [];
    const slots = L.slots;
    const n = L.items.length + (slots.back === null ? 0 : 1);
    const all = slots.back === null ? slots.items : slots.items.concat([slots.back]);
    if (n > 1) {
      all.forEach((a) => {
        const b = a + 180 / n;
        const p0 = G.polar(0, 0, b, 66), p1 = G.polar(0, 0, b, L.r + 42);
        svgEl('line', { class: 'sep', x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }, L.seps);
      });
    }
    L.items.forEach((it, i) => {
      const node = el('node', I.icon(it.icon || 'circle'), L.nodeBox);
      node.dataset.slot = String(i);
      const label = el('label', escapeHtml(it.name), L.nodeBox);
      const N = {
        it, el: node, label, angle: slots.items[i], back: false,
        r: spring(0, 330, 23), sc: spring(0.35, 420, 22), lop: spring(0, 400, 32),
        dx: spring(0, 520, 34), dy: spring(0, 520, 34), delay: i * 0.018, dots: [],
      };
      if (it.items && it.items.length) {
        const g = G.slotAngles(it.items.length, G.norm(N.angle + 180));
        g.items.forEach((ga) => N.dots.push({ el: el('gdot', undefined, L.nodeBox), a: ga }));
      }
      L.nodes.push(N);
    });
    if (slots.back !== null) {
      // The way back is the parent's own (shrunken) center, which already sits
      // in this direction; this node only carries the aiming logic.
      const node = el('node back', I.icon('arrow_back'), L.nodeBox);
      node.style.display = 'none';
      node.dataset.slot = 'back';
      L.nodes.push({
        it: null, el: node, label: null, angle: slots.back, back: true,
        r: spring(0, 330, 23), sc: spring(0.4, 420, 22), lop: spring(0, 400, 32),
        dx: spring(0, 520, 34), dy: spring(0, 520, 34), delay: 0, dots: [],
      });
    }
    L.builtAt = performance.now();
  }

  // A level that is no longer the current one: keep only its (shrunken) center.
  function demote(L) {
    L.nodeBox.innerHTML = '';
    L.nodes = [];
    L.halo.style.display = 'none';
    L.wedgeSvg.style.display = 'none';
    L.rim.style.display = 'none';
    L.cScale.t = 0.46;
    L.op.t = 0.8;
    L.iconOp.t = 1;
    L.textOp.t = 0;
    L.center.dataset.parent = String(st.levels.indexOf(L));
  }

  function promote(L) {
    L.halo.style.display = '';
    L.wedgeSvg.style.display = '';
    L.rim.style.display = '';
    L.cScale.t = 1;
    L.op.t = 1;
    delete L.center.dataset.parent;
    buildNodes(L);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  const passOpens = () => st.menu.passOpens !== false;

  // Ring i's colour: the theme's palette, or the person's own colours.
  function catColor(i) {
    return T.ringColor(st.menu, i);
  }

  // ------------------------------------------------------------ state changes

  function open({ x, y, menu, category: catIndex, mode, images }) {
    if (images) I.setImages(images);
    hardClear();
    T.apply(stage, menu.theme, 'ring');
    const scale = Math.max(0.62, Math.min(1, Math.min(innerWidth, innerHeight) / 640)) * (menu.ringScale || 1);
    st = {
      menu,
      cat: Math.min(catIndex || 0, menu.categories.length - 1),
      levels: [],
      hover: -1,
      mode: mode === 'click' ? 'click' : 'hold',
      openedAt: performance.now(),
      lastChange: performance.now(),
      px: x,
      py: y,
      s: scale,
      fade: spring(1, 500, 34),
      closing: null,
      press: null, // pointer down on a center: becomes a click or a drag
      dragging: false,
      kept: false, // dragged or docked: the trigger coming up no longer closes it
    };
    st.links = svgEl('svg', { class: 'links', width: 1, height: 1 });
    stage.appendChild(st.links);
    stage.style.setProperty('--accent', catColor(st.cat));
    pushLevel(category().items, x, y, null, null, null, category().icon);
    buildDock();
    startLoop();
  }

  // ------------------------------------------------------------ the dock
  // One small button per ring under the ring itself: any ring is one click
  // away, and you can see which rings there are without cycling through them.
  // The gear at the end opens Settings.

  function buildDock() {
    if (st.dock) st.dock.remove();
    st.dock = null;
    const cats = st.menu.categories;
    if (st.menu.dock === false) return;
    const d = el('dock');
    const chips = cats.length > 1
      ? cats.map((c, i) => `<button class="dchip" data-cat="${i}" style="--c:${escapeHtml(catColor(i))}" title="${escapeHtml(c.name)}">${I.icon(c.icon || 'circle')}</button>`).join('') + '<span class="dsep"></span>'
      : '';
    d.innerHTML =
      '<div class="dchips">' + chips +
      `<button class="dchip dset" data-act="settings" title="RadGesture settings">${I.icon('settings')}</button>` +
      '</div><div class="dname"></div><div class="dhint">drag the middle to move</div>';
    st.dock = d;
    st.dockName = d.querySelector('.dname');
    st.dockHover = -1;
    stage.appendChild(d);
    paintDock();
  }

  function paintDock() {
    if (!st.dock) return;
    st.dock.querySelectorAll('.dchip').forEach((b, i) => b.classList.toggle('on', i === st.cat));
    if (st.dockHover === DOCK_SETTINGS) {
      st.dockName.textContent = 'Settings';
      st.dockName.classList.add('hot');
      return;
    }
    const i = st.dockHover >= 0 ? st.dockHover : st.cat;
    st.dockName.textContent = st.menu.categories[i].name;
    st.dockName.classList.toggle('hot', st.dockHover >= 0 && st.dockHover !== st.cat);
  }

  // The dock sits clear of everything open: below the lowest ring (a smaller
  // ring opened down-left or down-right used to land on it), else above the
  // highest, else it steps aside until you go back.
  function placeDock(dt) {
    if (!st.dock) return;
    const root = st.levels[0];
    let lo = -Infinity;
    let hi = Infinity;
    st.levels.forEach((L, i) => {
      const reach = (i === st.levels.length - 1 ? L.r + 34 : 30) * st.s; // open ring: its directions; parents: their small center
      const cy = L.cy + L.oy.x;
      lo = Math.max(lo, cy + reach);
      hi = Math.min(hi, cy - reach);
    });
    const gap = (DOCK_GAP - 34) * st.s; // with only the main ring open: where it always was
    const yBelow = lo + gap;
    const yAbove = hi - gap;
    const below = yBelow + 60 < innerHeight;
    const fits = below || yAbove - 70 > 0;
    const y = below ? yBelow : yAbove;
    if (!st.dockY) st.dockY = spring(y, 300, 30);
    st.dockY.t = y;
    if (dt) step(st.dockY, dt);
    const x = root.cx + root.ox.x;
    st.dock.style.transform = `translate(${x}px, ${st.dockY.x}px) scale(${st.s})`;
    st.dock.classList.toggle('above', !below);
    st.dock.style.opacity = String(fits ? clamp01(root.op.x) : 0);
    st.dock.style.pointerEvents = fits ? '' : 'none';
    return !settled(st.dockY);
  }

  function jumpTo(index) {
    if (index === st.cat) {
      while (st.levels.length > 1) popLevel();
      return;
    }
    const n = st.menu.categories.length;
    const fwd = (index - st.cat + n) % n;
    switchCategory(fwd <= n / 2 ? fwd : fwd - n);
  }

  // Which center is under the point (by position, not by DOM target: just
  // after a switch the new directions are still springing out of the middle
  // and would swallow the click). Returns a level index or -1.
  function centerAt(x, y) {
    for (let i = st.levels.length - 1; i >= 0; i--) {
      const L = st.levels[i];
      const r = 56 * st.s * Math.max(0.46, L.cScale.t);
      if (Math.hypot(x - (L.cx + L.ox.x), y - (L.cy + L.oy.x)) <= r) return i;
    }
    return -1;
  }

  // Move the whole ring (every open level) by dx, dy, kept on screen.
  function moveBy(dx, dy) {
    const root = st.levels[0];
    const m = 70 * st.s;
    dx = Math.max(m - root.cx, Math.min(innerWidth - m - root.cx, dx));
    dy = Math.max(m - root.cy, Math.min(innerHeight - m - root.cy, dy));
    st.levels.forEach((L) => {
      L.cx += dx;
      L.cy += dy;
    });
  }

  function pushLevel(items, x, y, backAngle, name, fromNode, iconName) {
    const sub = st.levels.length > 0;
    const c = G.clampCenter(x, y, innerWidth, innerHeight, EDGE * st.s);
    const L = {
      items, name, icon: iconName, sub,
      cx: c.x, cy: c.y,
      r: sub ? R_SUB : R_ROOT,
      slots: G.slotAngles(items.length, backAngle),
    };
    if (sub) demote(cur());
    st.levels.push(L);
    buildLevel(L, fromNode);
    if (sub) {
      L.link = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 0 }, st.links);
    }
    st.hover = -1;
    st.lastChange = performance.now();
    paintHover();
  }

  function nodeScreenPos(L, N) {
    const p = G.polar(0, 0, N.angle + L.spin.x, N.r.x);
    return { x: L.cx + L.ox.x + (p.x + N.dx.x) * st.s, y: L.cy + L.oy.x + (p.y + N.dy.x) * st.s };
  }

  function openSub(index) {
    const L = cur();
    const N = L.nodes[index];
    const p = nodeScreenPos(L, N);
    const target = G.clampCenter(p.x, p.y, innerWidth, innerHeight, EDGE * st.s);
    pushLevel(N.it.items, target.x, target.y, G.angleOf(L.cx - target.x, L.cy - target.y), N.it.name, p, N.it.icon);
  }

  function popLevel() {
    if (st.levels.length < 2) return;
    const L = st.levels.pop();
    L.layer.remove();
    if (L.link) L.link.remove();
    promote(cur());
    st.hover = -1;
    st.lastChange = performance.now();
    paintHover();
  }

  function switchCategory(stepBy) {
    const n = st.menu.categories.length;
    if (n < 2) return;
    const root = st.levels[0];
    st.levels.forEach((L) => {
      L.layer.remove();
      if (L.link) L.link.remove();
    });
    st.levels = [];
    st.cat = (st.cat + stepBy + n) % n;
    stage.style.setProperty('--accent', catColor(st.cat));
    pushLevel(category().items, root.cx, root.cy, null, null, null, category().icon);
    const L = cur();
    L.spin.x = stepBy > 0 ? -38 : 38; // spin in from the side you scrolled toward
    L.cScale.x = 0.92;
    paintDock();
  }

  function hardClear() {
    st = null;
    stage.innerHTML = '';
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function clear() {
    hardClear();
  }

  // Animate out, then tell whoever opened us.
  function finish(after, chosenNode) {
    if (!st || st.closing) return;
    st.closing = { after, at: performance.now() };
    st.fade.t = 0;
    if (chosenNode) {
      chosenNode.sc.t = 1.38;
      chosenNode.sc.v = 6;
    }
  }

  function choose(N) {
    const item = { name: N.it.name, action: N.it.action };
    if (N.it.stay) return keepOpen(N, item);
    finish(() => {}, N);
    hooks.select(item); // the action starts now; the fade is only for the eye
  }

  // A direction marked "stay" (previous / next, pressed again and again):
  // it runs, pulses, and the ring stays open for the next click.
  function keepOpen(N, item) {
    N.sc.v = 7;
    st.mode = 'click';
    hooks.select(Object.assign(item, { stay: true }));
  }

  function dismiss() {
    finish(() => hooks.dismiss());
  }

  function activate(target) {
    if (target === 'back') return popLevel();
    const N = cur().nodes[target];
    if (N.it.items) return openSub(target);
    choose(N);
  }

  // The pair the center of a smaller ring steps through (left button back,
  // right button forward): its key images when it has several pairs.
  function centerPair(L) {
    let first = null;
    for (let i = 0; i < L.nodes.length; i++) {
      const p = pairOf(L, i);
      if (!p) continue;
      if (/key image/i.test(L.nodes[p.prev].it.name)) return p;
      first = first || p;
    }
    return first;
  }

  // A previous / next pair that keeps the ring open ("Previous layout" and
  // "Next layout"), found from the direction at i.
  function pairOf(L, i) {
    const N = L.nodes[i];
    if (!N || !N.it || !N.it.stay || N.it.items) return null;
    const m = /^(previous|next)\s+(.+)$/i.exec(String(N.it.name || '').trim());
    if (!m) return null;
    const rest = m[2].toLowerCase();
    const find = (w) => L.nodes.findIndex((x) => x && x.it && x.it.stay && String(x.it.name || '').trim().toLowerCase() === w + ' ' + rest);
    const prev = find('previous'), next = find('next');
    return prev >= 0 && next >= 0 ? { prev, next } : null;
  }

  // The hub calls this when the trigger key comes up.
  function release() {
    if (!st || st.closing) return { type: 'none' };
    const L = cur();
    if (st.kept || st.press) {
      st.mode = 'click';
      return { type: 'stay' };
    }
    if (st.hover === 'back') {
      popLevel();
      st.mode = 'click';
      return { type: 'stay' };
    }
    if (st.hover !== -1) {
      const N = L.nodes[st.hover];
      if (N.it.items) {
        openSub(st.hover);
        st.mode = 'click';
        return { type: 'stay' };
      }
      const item = { name: N.it.name, action: N.it.action };
      if (N.it.stay) {
        N.sc.v = 7;
        st.mode = 'click';
        return { type: 'select', item: Object.assign(item, { stay: true }) };
      }
      finish(() => {}, N);
      return { type: 'select', item };
    }
    if (performance.now() - st.openedAt < TAP_MS || st.levels.length > 1) {
      st.mode = 'click';
      return { type: 'stay' };
    }
    finish(() => {});
    return { type: 'none' };
  }

  // ------------------------------------------------------------ aiming

  function slotIndexOf(target) {
    if (target === -1) return -1;
    if (target === 'back') return cur().nodes.length - 1;
    return target;
  }

  function aim() {
    if (!st || st.closing || st.dragging) return;
    const L = cur();
    const dx = (st.px - L.cx) / st.s;
    const dy = (st.py - L.cy) / st.s;
    const target = G.aimAt(L.slots, dx, dy, DEAD);
    const dist = Math.hypot(dx, dy);
    // Moving past a direction that holds more opens it (past the way back:
    // back). While holding that is the flick itself; with the ring left open
    // it waits a moment, so passing on the way to the dock opens nothing.
    // Settings > General can turn it off (`passOpens: false`): then click.
    const pass = target !== -1 && passOpens() &&
      (target === 'back' ? dist > L.r * 0.78 + PASS : L.items[target].items && dist > L.r + PASS);
    if (!pass) st.passing = null;
    else if (st.mode === 'hold') return target === 'back' ? popLevel() : openSub(target);
    else {
      const now = performance.now();
      if (!st.passing || st.passing.target !== target || st.passing.level !== st.levels.length) {
        st.passing = { target, level: st.levels.length, since: now };
        setTimeout(aim, PASS_DWELL_MS + 10);
      } else if (now - st.passing.since >= PASS_DWELL_MS) {
        st.passing = null;
        return target === 'back' ? popLevel() : openSub(target);
      }
    }
    if (target !== st.hover) {
      st.hover = target;
      st.lastChange = performance.now();
      paintHover();
    }
  }

  function paintHover() {
    const L = cur();
    if (!L || !L.nodes) return;
    const on = slotIndexOf(st.hover);
    L.nodes.forEach((N, i) => {
      N.el.classList.toggle('on', i === on);
      if (N.label) N.label.classList.toggle('on', i === on);
      N.dots.forEach((d) => d.el.classList.toggle('on', i === on));
    });
    const parentL = st.levels[st.levels.length - 2];
    if (parentL) parentL.center.classList.toggle('on', st.hover === 'back');
    let title = '';
    if (st.hover === 'back') title = 'Back';
    else if (st.hover !== -1) title = L.items[st.hover].name;
    L.cTitle.textContent = title;
    L.iconOp.t = title ? 0 : 1;
    L.textOp.t = title ? 1 : 0;
    if (L.cName) L.cName.style.visibility = title ? 'hidden' : '';
    if (L.cDots) L.cDots.style.visibility = title ? 'hidden' : '';
    if (on >= 0) {
      const N = L.nodes[on];
      const n = L.slots.items.length + (L.slots.back === null ? 0 : 1);
      L.hlHalf = 180 / n - 1.5;
      // Glide the short way round; appearing from nothing starts in place.
      const target = L.hlA.x + G.angDiffSigned(L.hlA.x, N.angle);
      if (L.hlOp.x < 0.05) snap(L.hlA, target);
      else L.hlA.t = target;
      L.hlOp.t = 1;
    } else {
      L.hlOp.t = 0;
    }
  }

  // ------------------------------------------------------------ the frame loop

  function startLoop() {
    if (raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(t) {
    raf = 0;
    if (!st) return;
    const dt = Math.min(0.032, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    const now = performance.now();
    const L = cur();
    const pdx = (st.px - L.cx) / st.s;
    const pdy = (st.py - L.cy) / st.s;
    const pdist = Math.hypot(pdx, pdy);
    const pang = G.angleOf(pdx, pdy);
    const hoverIdx = slotIndexOf(st.hover);
    const lm = labelMode();
    const paused = now - st.lastChange > LABEL_PAUSE_MS;

    // Rim pointer: follow the cursor the short way round.
    let ta = pang;
    while (ta - L.rimA.x > 180) ta -= 360;
    while (ta - L.rimA.x < -180) ta += 360;
    L.rimA.t = ta;
    L.rimOp.t = pdist > DEAD && !st.closing ? 1 : 0;

    let busy = false;
    const sinceBuilt = (now - L.builtAt) / 1000;

    L.nodes.forEach((N, i) => {
      const started = sinceBuilt >= N.delay;
      const hovered = i === hoverIdx;
      const diff = G.angDiff(pang, N.angle);
      N.r.t = started ? (N.back ? L.r * 0.78 : L.r) : 0;
      if (!st.closing || N.sc.t < 1.3) {
        N.sc.t = !started ? 0.35 : hovered ? 1.2 : hoverIdx >= 0 ? 1.1 - Math.pow(diff / 180, 0.25) * 0.12 : 1;
      }
      // Flick: the aimed direction stretches out after the hand.
      if (hovered && !N.back && pdist > L.r && (st.mode === 'hold' || (passOpens() && N.it.items))) {
        const reach = Math.min(pdist - L.r, PASS + 6) * 0.85;
        const p = G.polar(0, 0, N.angle, reach);
        N.dx.t = p.x;
        N.dy.t = p.y;
      } else {
        N.dx.t = 0;
        N.dy.t = 0;
      }
      const showLabel = !hovered && started && (lm === 'always' || (lm === 'pause' && paused));
      N.lop.t = showLabel ? 1 : 0;
      [N.r, N.sc, N.dx, N.dy, N.lop].forEach((s) => {
        step(s, dt);
        if (!settled(s)) busy = true;
      });
      if (!started) busy = true;
    });

    // Levels: position, scale, fade.
    st.levels.forEach((Lv) => {
      [Lv.cScale, Lv.op, Lv.ox, Lv.oy, Lv.iconOp, Lv.textOp, Lv.rimOp, Lv.rimA, Lv.hlOp, Lv.hlA, Lv.spin].forEach((s) => {
        step(s, dt);
        if (!settled(s)) busy = true;
      });
    });
    step(st.fade, dt);
    if (!settled(st.fade)) busy = true;

    // ---- write ----
    stage.style.opacity = String(Math.max(0, Math.min(1, st.fade.x)));
    st.levels.forEach((Lv, li) => {
      const isCur = li === st.levels.length - 1;
      Lv.layer.style.transform = `translate(${Lv.cx + Lv.ox.x}px, ${Lv.cy + Lv.oy.x}px) scale(${st.s})`;
      Lv.layer.style.opacity = String(Math.max(0, Math.min(1, Lv.op.x)));
      Lv.center.style.transform = `scale(${Lv.cScale.x})`;
      Lv.cIcon.style.opacity = String(clamp01(Lv.iconOp.x));
      Lv.cText.style.opacity = String(clamp01(Lv.textOp.x));
      if (isCur) {
        Lv.rim.style.transform = `rotate(${Lv.rimA.x}deg) scale(${Lv.cScale.x})`;
        Lv.rim.style.opacity = String(clamp01(Lv.rimOp.x));
        Lv.hlPath.style.opacity = String(clamp01(Lv.hlOp.x));
        const hk = Lv.hlA.x.toFixed(2) + '|' + Lv.hlHalf;
        if (Lv.hlOp.x > 0.01 && hk !== Lv.hlDrawn) {
          Lv.hlPath.setAttribute('d', sector(Lv.hlA.x, Lv.hlHalf, 62, Lv.r + 46));
          Lv.hlDrawn = hk;
        }
        Lv.wedgeSvg.style.transform = `rotate(${Lv.spin.x}deg)`;
      }
      if (Lv.link) {
        const prev = st.levels[li - 1];
        Lv.link.setAttribute('x1', prev.cx + prev.ox.x);
        Lv.link.setAttribute('y1', prev.cy + prev.oy.x);
        Lv.link.setAttribute('x2', Lv.cx + Lv.ox.x);
        Lv.link.setAttribute('y2', Lv.cy + Lv.oy.x);
      }
    });

    if (placeDock(dt)) busy = true;
    if (st.dock) st.dock.classList.toggle('hint', paused && lm !== 'never' && st.mode === 'click');

    L.nodes.forEach((N, i) => {
      const a = N.angle + L.spin.x;
      const p = G.polar(0, 0, a, N.r.x);
      const x = p.x + N.dx.x;
      const y = p.y + N.dy.x;
      N.el.style.transform = `translate(${x}px, ${y}px) scale(${Math.max(0, N.sc.x)})`;
      N.el.style.opacity = String(clamp01(N.r.x / Math.max(1, L.r) * 1.4));
      if (N.label) {
        const lp = G.polar(0, 0, a, N.r.x + 46);
        const s = Math.sin((a * Math.PI) / 180);
        const c = Math.cos((a * Math.PI) / 180);
        N.label.style.transform = `translate(${lp.x + N.dx.x}px, ${lp.y + N.dy.x}px) translate(${-50 + s * 50}%, ${-50 - c * 50}%)`;
        N.label.style.opacity = String(clamp01(N.lop.x));
      }
      N.dots.forEach((d) => {
        const dp = G.polar(x, y, d.a, 38 * Math.max(0.4, N.sc.x));
        d.el.style.transform = `translate(${dp.x}px, ${dp.y}px)`;
        d.el.style.opacity = String(clamp01(N.sc.x - 0.3));
      });
    });

    if (st.closing && st.fade.x < 0.04) {
      const after = st.closing.after;
      hardClear();
      after();
      return;
    }
    if (busy || st.mode === 'hold' || L.rimOp.x > 0.01 || st.closing) {
      raf = requestAnimationFrame(frame);
    } else {
      // Nothing moving: wake again on the next pointer move or for the labels.
      if (lm === 'pause' && !paused) setTimeout(startLoop, LABEL_PAUSE_MS + 30);
    }
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // ------------------------------------------------------------ input

  window.addEventListener('pointermove', (e) => {
    if (!st) return;
    const P = st.press;
    if (P && !st.dragging && Math.hypot(e.clientX - P.x, e.clientY - P.y) > DRAG_PX) {
      st.dragging = true;
      st.kept = true;
      st.mode = 'click';
      st.hover = -1;
      paintHover();
      document.body.classList.add('dragging');
    }
    if (st.dragging) {
      moveBy(e.clientX - P.lx, e.clientY - P.ly);
      P.lx = e.clientX;
      P.ly = e.clientY;
    }
    st.px = e.clientX;
    st.py = e.clientY;
    const chip = e.target.closest && e.target.closest('[data-cat]');
    const gear = e.target.closest && e.target.closest('[data-act="settings"]');
    const dh = chip ? Number(chip.dataset.cat) : gear ? DOCK_SETTINGS : -1;
    if (st.dock && dh !== st.dockHover) {
      st.dockHover = dh;
      paintDock();
    }
    if (dh !== -1) {
      if (st.hover !== -1) {
        st.hover = -1;
        paintHover();
      }
    } else {
      aim();
    }
    startLoop();
  });

  window.addEventListener('pointerup', (e) => {
    if (!st || e.button !== 0 || !st.press) return;
    const P = st.press;
    const dragged = st.dragging;
    st.press = null;
    st.dragging = false;
    document.body.classList.remove('dragging');
    if (dragged || st.closing) return startLoop();
    // A click on a center, not a drag. The center of a smaller ring holding
    // a previous / next pair steps back through it (the right button forward).
    const cp = P.parent === null && st.levels.length > 1 && centerPair(cur());
    if (cp) {
      choose(cur().nodes[cp.prev]);
      return startLoop();
    }
    if (P.parent !== null) {
      while (st.levels.length - 1 > P.parent) popLevel();
    } else if (st.levels.length > 1) popLevel();
    else switchCategory(1);
    startLoop();
  });

  window.addEventListener('pointerdown', (e) => {
    if (!st || st.closing || e.button !== 0) return;
    st.px = e.clientX;
    st.py = e.clientY;
    if (e.target.closest && e.target.closest('[data-act="settings"]')) {
      finish(() => {});
      hooks.select({ name: 'Settings', action: 'hub:settings' });
      return;
    }
    const chip = e.target.closest && e.target.closest('[data-cat]');
    if (chip) {
      st.kept = true;
      st.mode = 'click';
      jumpTo(Number(chip.dataset.cat));
      startLoop();
      return;
    }
    // A center: decided on release - a click (switch / go back) or a drag.
    const ci = centerAt(e.clientX, e.clientY);
    if (ci >= 0) {
      st.press = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, parent: ci < st.levels.length - 1 ? ci : null };
      return;
    }
    if (e.target.closest && e.target.closest('.dock')) return;
    const L = cur();
    const dist = Math.hypot(st.px - L.cx, st.py - L.cy) / st.s;
    if (dist > L.r + 80) return dismiss();
    const target = G.aimAt(L.slots, (st.px - L.cx) / st.s, (st.py - L.cy) / st.s, DEAD);
    if (target !== -1) activate(target);
    startLoop();
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!st || st.closing) return;
    // The center of a smaller ring that holds a previous / next pair: the
    // right button steps forward (the left one steps back).
    {
      const L = cur();
      const cp = st.levels.length > 1 && centerAt(e.clientX, e.clientY) === st.levels.length - 1 && centerPair(L);
      if (cp) {
        choose(L.nodes[cp.next]);
        return startLoop();
      }
    }
    if (st.levels.length > 1) popLevel();
    else if (centerAt(e.clientX, e.clientY) === 0) switchCategory(-1); // right-click the middle: previous ring
    else dismiss();
    startLoop();
  });

  window.addEventListener('wheel', (e) => {
    if (!st || st.closing) return;
    e.preventDefault();
    if (st.levels.length > 1) while (st.levels.length > 1) popLevel();
    switchCategory(e.deltaY > 0 ? 1 : -1);
    startLoop();
  }, { passive: false });

  // ------------------------------------------------------------ wiring

  window.RGRing = {
    open,
    release,
    clear,
    hooks,
    state: () => (st && !st.closing ? { levels: st.levels, hover: st.hover, cat: st.cat, mode: st.mode, x: st.levels[0].cx, y: st.levels[0].cy } : null),
  };

  if (window.radgesture) {
    window.radgesture.onOpen(open);
    window.radgesture.onRelease(release);
    window.radgesture.onClose(hardClear);
    hooks.select = (item) => window.radgesture.select(item);
    hooks.dismiss = () => window.radgesture.dismiss();
  }
})();
