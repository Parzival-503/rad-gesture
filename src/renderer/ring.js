// The ring. Two ways to use it, both always available:
//
//  Flick: hold the trigger, move toward a direction, let go. Moving past a
//         direction that has more inside opens its smaller ring right there
//         (Kando's idea), so a whole path can be one stroke.
//  Click: tap the trigger and the ring stays open; click a direction.
//
// The center switches category (DragShift's idea): click it or scroll the
// wheel. In a smaller ring the center (or the small arrow) goes back.

(function () {
  const G = window.RGGeometry;
  const I = window.RGIcons;

  const R_ROOT = 122; // distance of the directions from the center
  const R_SUB = 106;
  const DEAD = 34; // pointer this close to the center aims at nothing
  const PASS = 34; // moving this far beyond a direction opens its smaller ring
  const TAP_MS = 320; // a release sooner than this is a tap: stay open for clicks
  const EDGE = 175; // keep the ring this far from the screen edge

  const stage = document.getElementById('stage');
  const hooks = { select() {}, dismiss() {} };
  let st = null;

  const cur = () => st.levels[st.levels.length - 1];
  const category = () => st.menu.categories[st.cat];

  // ------------------------------------------------------------ state

  function open({ x, y, menu, category: cat, mode }) {
    st = {
      menu,
      cat: cat || 0,
      levels: [],
      hover: -1,
      mode: mode === 'click' ? 'click' : 'hold',
      openedAt: performance.now(),
      px: x,
      py: y,
      s: Math.max(0.62, Math.min(1, Math.min(innerWidth, innerHeight) / 620)),
    };
    const c = G.clampCenter(x, y, innerWidth, innerHeight, EDGE * st.s);
    pushLevel(category().items, c.x, c.y, null, null);
  }

  function pushLevel(items, cx, cy, backAngle, name) {
    const r = st.levels.length ? R_SUB : R_ROOT;
    st.levels.push({ items, cx, cy, r, name, slots: G.slotAngles(items.length, backAngle) });
    st.hover = -1;
    render();
    aim();
  }

  function openSub(index) {
    const lv = cur();
    const it = lv.items[index];
    const p = G.polar(lv.cx, lv.cy, lv.slots.items[index], lv.r * st.s);
    const c = G.clampCenter(p.x, p.y, innerWidth, innerHeight, EDGE * st.s);
    pushLevel(it.items, c.x, c.y, G.angleOf(lv.cx - c.x, lv.cy - c.y), it.name);
  }

  function popLevel() {
    if (st.levels.length < 2) return;
    st.levels.pop();
    st.hover = -1;
    render();
    aim();
  }

  function switchCategory(step) {
    const n = st.menu.categories.length;
    if (n < 2) return;
    const root = st.levels[0];
    st.cat = (st.cat + step + n) % n;
    st.levels = [];
    pushLevel(category().items, root.cx, root.cy, null, null);
  }

  function clear() {
    st = null;
    stage.innerHTML = '';
  }

  function choose(item) {
    clear();
    hooks.select({ name: item.name, action: item.action });
  }

  function dismiss() {
    clear();
    hooks.dismiss();
  }

  function activate(target) {
    const lv = cur();
    if (target === 'back') return popLevel();
    const it = lv.items[target];
    if (it.items) return openSub(target);
    choose(it);
  }

  // The hub calls this when the trigger comes up.
  function release() {
    if (!st) return { type: 'none' };
    const lv = cur();
    if (st.hover === 'back') {
      popLevel();
      st.mode = 'click';
      return { type: 'stay' };
    }
    if (st.hover !== -1) {
      const it = lv.items[st.hover];
      if (it.items) {
        openSub(st.hover);
        st.mode = 'click';
        return { type: 'stay' };
      }
      clear();
      return { type: 'select', item: { name: it.name, action: it.action } };
    }
    if (performance.now() - st.openedAt < TAP_MS || st.levels.length > 1) {
      st.mode = 'click';
      return { type: 'stay' };
    }
    clear();
    return { type: 'none' };
  }

  // ------------------------------------------------------------ aiming

  function aim() {
    if (!st) return;
    const lv = cur();
    const dx = st.px - lv.cx;
    const dy = st.py - lv.cy;
    const target = G.aimAt(lv.slots, dx, dy, DEAD * st.s);
    const dist = Math.hypot(dx, dy) / st.s;

    if (st.mode === 'hold') {
      if (target !== -1 && target !== 'back' && lv.items[target].items && dist > lv.r + PASS) return openSub(target);
      if (target === 'back' && dist > lv.r * 0.78 + PASS) return popLevel();
    }
    if (target === st.hover) return;
    st.hover = target;
    paintHover();
  }

  function paintHover() {
    const el = stage.querySelector('.level.current');
    if (!el) return;
    el.querySelectorAll('[data-slot]').forEach((n) => n.classList.toggle('on', n.dataset.slot === String(st.hover)));
    const lv = cur();
    const title = el.querySelector('.center .title');
    const hint = el.querySelector('.center .hint');
    const name = st.hover === 'back' ? 'Back' : st.hover !== -1 ? lv.items[st.hover].name : '';
    title.textContent = name;
    title.style.display = name ? '' : 'none';
    // Idle: a quiet reminder of what the center does.
    hint.style.display = name ? 'none' : '';
  }

  // ------------------------------------------------------------ drawing

  function sector(a, half, r0, r1) {
    const p = (ang, r) => G.polar(0, 0, ang, r);
    const a0 = a - half;
    const a1 = a + half;
    const large = half * 2 > 180 ? 1 : 0;
    const o0 = p(a0, r1), o1 = p(a1, r1), i1 = p(a1, r0), i0 = p(a0, r0);
    return `M${o0.x},${o0.y} A${r1},${r1} 0 ${large} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${r0},${r0} 0 ${large} 0 ${i0.x},${i0.y} Z`;
  }

  function labelStyle(angle, r) {
    const p = G.polar(0, 0, angle, r);
    const s = Math.sin((angle * Math.PI) / 180);
    const c = Math.cos((angle * Math.PI) / 180);
    // Anchor the label's near edge toward the center so it never covers the ring.
    return `left:${p.x}px;top:${p.y}px;transform:translate(${-50 + s * 50}%,${-50 - c * 50}%)`;
  }

  function render() {
    const cat = category();
    stage.style.setProperty('--accent', cat.color || '#7aa2ff');
    stage.classList.toggle('hide-labels', st.menu.showLabels === false);
    let html = '';

    // Dashed thread through the centers of the rings you came through.
    if (st.levels.length > 1) {
      html += '<svg class="thread">';
      for (let i = 1; i < st.levels.length; i++) {
        const a = st.levels[i - 1], b = st.levels[i];
        html += `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}"/>`;
      }
      html += '</svg>';
    }

    st.levels.forEach((lv, li) => {
      const isCur = li === st.levels.length - 1;
      const cls = ['level', isCur ? 'current' : 'parent', li ? 'sub' : 'root'].join(' ');
      html += `<div class="${cls}" style="left:${lv.cx}px;top:${lv.cy}px;scale:${st.s}">`;
      if (isCur) {
        html += '<div class="halo"></div>';
        html += `<div class="track" style="width:${lv.r * 2}px;height:${lv.r * 2}px;margin:${-lv.r}px 0 0 ${-lv.r}px"></div>`;
        const n = lv.items.length + (lv.slots.back === null ? 0 : 1);
        const half = 180 / n - 3;
        html += '<svg class="wedges">';
        lv.slots.items.forEach((a, i) => (html += `<path class="wedge" data-slot="${i}" d="${sector(a, half, 60, lv.r + 44)}"/>`));
        if (lv.slots.back !== null) html += `<path class="wedge" data-slot="back" d="${sector(lv.slots.back, half, 52, lv.r)}"/>`;
        html += '</svg>';
      }

      const dots = li === 0 && st.menu.categories.length > 1
        ? '<div class="dots">' + st.menu.categories.map((_, i) => `<i class="${i === st.cat ? 'on' : ''}"></i>`).join('') + '</div>'
        : '';
      const hint = li ? 'Center: back' : st.menu.categories.length > 1 ? 'Scroll or click<br>to switch' : 'Flick or click';
      html += `<div class="center" data-center="1">
        <div class="cat">${I.icon(cat.icon || 'dot')}<span>${esc(lv.name || cat.name)}</span></div>
        <div class="title"></div><div class="hint">${hint}</div>${dots}</div>`;

      if (isCur) {
        lv.items.forEach((it, i) => {
          const a = lv.slots.items[i];
          const p = G.polar(0, 0, a, lv.r);
          html += `<div class="item" data-slot="${i}" style="left:${p.x}px;top:${p.y}px;animation-delay:${i * 14}ms">
            ${I.icon(it.icon || 'dot')}${it.items ? `<span class="more" style="transform:rotate(${a}deg)"></span>` : ''}</div>`;
          html += `<div class="label" data-slot="${i}" style="${labelStyle(a, lv.r + 40)};animation-delay:${40 + i * 14}ms">${esc(it.name)}</div>`;
        });
        if (lv.slots.back !== null) {
          const a = lv.slots.back;
          const p = G.polar(0, 0, a, lv.r * 0.78);
          html += `<div class="item back" data-slot="back" style="left:${p.x}px;top:${p.y}px">
            <span style="display:flex;transform:rotate(${a + 90}deg)">${I.icon('back')}</span></div>`;
        }
      }
      html += '</div>';
    });
    stage.innerHTML = html;
    paintHover();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // ------------------------------------------------------------ input

  window.addEventListener('pointermove', (e) => {
    if (!st) return;
    st.px = e.clientX;
    st.py = e.clientY;
    aim();
  });

  window.addEventListener('pointerdown', (e) => {
    if (!st || e.button !== 0) return;
    const lv = cur();
    st.px = e.clientX;
    st.py = e.clientY;
    const dist = Math.hypot(st.px - lv.cx, st.py - lv.cy) / st.s;
    if (e.target.closest('[data-center]') && e.target.closest('.level.current')) {
      if (st.levels.length > 1) popLevel();
      else switchCategory(1);
      return;
    }
    if (dist > lv.r + 70) return dismiss();
    const target = G.aimAt(lv.slots, st.px - lv.cx, st.py - lv.cy, DEAD * st.s);
    if (target !== -1) activate(target);
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!st) return;
    if (st.levels.length > 1) popLevel();
    else dismiss();
  });

  window.addEventListener('wheel', (e) => {
    if (!st) return;
    e.preventDefault();
    switchCategory(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // ------------------------------------------------------------ wiring

  window.RGRing = { open, release, clear, hooks, state: () => st };

  if (window.radgesture) {
    window.radgesture.onOpen(open);
    window.radgesture.onRelease(release);
    window.radgesture.onClose(clear);
    hooks.select = (item) => window.radgesture.select(item);
    hooks.dismiss = () => window.radgesture.dismiss();
  }
})();
