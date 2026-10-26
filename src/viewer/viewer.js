// The reference viewer: one note or picture from the Reference Library, opened
// from the ring. Read-only; Edit goes to Settings > References. Esc closes.
//
// A picture sits on a stage: the mouse wheel zooms around the pointer, drag
// pans, double-click switches between fit and actual size; keys: + / - zoom,
// 0 fit, 1 actual size, arrows pan.
(function () {
  const api = window.rgv;
  const T = window.RGThemes;
  const MD = window.RGMarkdown;
  const $ = (id) => document.getElementById(id);
  let current = new URLSearchParams(location.search).get('id');
  let view = null; // the picture's zoom and position, while one is shown

  async function show(id) {
    current = id;
    const { ref, theme } = await api.get(id);
    T.apply(document.documentElement, theme, 'ui');
    const page = $('page');
    page.innerHTML = '';
    page.classList.remove('pic');
    $('zoombar').hidden = true;
    view = null;
    if (!ref) {
      $('title').textContent = 'Not found';
      page.innerHTML = '<p>This reference was deleted.</p>';
      return;
    }
    document.title = ref.title;
    $('title').textContent = ref.title;
    $('tags').innerHTML = (ref.tags || []).map((t) => `<span class="chip">${MD.esc(t)}</span>`).join(' ');
    const body = document.createElement('div');
    body.innerHTML = MD.render(ref.body || ''); // MD escapes everything itself
    if (ref.image) {
      page.classList.add('pic');
      const stage = document.createElement('div');
      stage.className = 'stage';
      stage.id = 'stage';
      const img = document.createElement('img');
      img.alt = ref.title;
      img.draggable = false;
      stage.append(img);
      const hint = document.createElement('div');
      hint.className = 'stagehint';
      hint.textContent = 'Scroll to zoom · drag to move · double-click: fit / actual size';
      stage.append(hint);
      setTimeout(() => { hint.style.opacity = '0'; }, 3500);
      body.className = 'caption md';
      page.append(stage, body);
      $('zoombar').hidden = false;
      view = { stage, img, s: 1, x: 0, y: 0, fit: true };
      img.onload = () => { fitView(); window.__viewerReady = true; };
      img.src = ref.image;
      return;
    }
    page.append(body);
    window.__viewerReady = true;
  }

  // ---- zoom and pan
  const MIN = 0.05, MAX = 16;
  function apply() {
    if (!view) return;
    const { img, s, x, y } = view;
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    img.classList.toggle('pixels', s >= 3); // sharp pixels when looking closely
    $('zoomPct').textContent = Math.round(s * 100) + '%';
    window.__viewerZoom = s;
  }
  function fitScale() {
    const r = view.stage.getBoundingClientRect();
    const w = view.img.naturalWidth || 1, hgt = view.img.naturalHeight || 1;
    return Math.min(1, (r.width - 24) / w, (r.height - 24) / hgt);
  }
  function center(s) {
    const r = view.stage.getBoundingClientRect();
    view.s = s;
    view.x = (r.width - view.img.naturalWidth * s) / 2;
    view.y = (r.height - view.img.naturalHeight * s) / 2;
  }
  function fitView() {
    if (!view) return;
    center(fitScale());
    view.fit = true;
    apply();
  }
  // Zoom to scale s, keeping the point (px, py) of the stage where it is.
  function zoomTo(s, px, py) {
    if (!view) return;
    const r = view.stage.getBoundingClientRect();
    if (px === undefined) { px = r.width / 2; py = r.height / 2; }
    s = Math.max(MIN, Math.min(MAX, s));
    view.x = px - (px - view.x) * (s / view.s);
    view.y = py - (py - view.y) * (s / view.s);
    view.s = s;
    view.fit = false;
    apply();
  }
  const step = (dir, px, py) => view && zoomTo(view.s * (dir > 0 ? 1.25 : 0.8), px, py);

  document.addEventListener('wheel', (e) => {
    if (!view || !view.stage.contains(e.target)) return;
    e.preventDefault();
    const r = view.stage.getBoundingClientRect();
    // A touchpad pinch or a wheel notch: zoom by how far it moved.
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    zoomTo(view.s * k, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0 || !view.stage.contains(e.target)) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    view.stage.classList.add('dragging');
    view.stage.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || !view) return;
    view.x = drag.vx + e.clientX - drag.x;
    view.y = drag.vy + e.clientY - drag.y;
    view.fit = false;
    apply();
  });
  const endDrag = () => { drag = null; if (view) view.stage.classList.remove('dragging'); };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('dblclick', (e) => {
    if (!view || !view.stage.contains(e.target)) return;
    const r = view.stage.getBoundingClientRect();
    if (view.fit || Math.abs(view.s - fitScale()) < 0.01) zoomTo(1 === view.s ? 2 : 1, e.clientX - r.left, e.clientY - r.top);
    else fitView();
  });
  window.addEventListener('resize', () => { if (view && view.fit) fitView(); });

  $('zoomIn').addEventListener('click', () => step(1));
  $('zoomOut').addEventListener('click', () => step(-1));
  $('zoomFit').addEventListener('click', fitView);
  $('zoomPct').addEventListener('click', () => zoomTo(1));

  // Links open in the browser, never inside this window.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    api.openLink(a.getAttribute('href'));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return api.close();
    if (!view || e.target.closest('input, textarea')) return;
    const pan = 60;
    if (e.key === '+' || e.key === '=') step(1);
    else if (e.key === '-' || e.key === '_') step(-1);
    else if (e.key === '0') fitView();
    else if (e.key === '1') zoomTo(1);
    else if (e.key === 'ArrowLeft') { view.x += pan; apply(); }
    else if (e.key === 'ArrowRight') { view.x -= pan; apply(); }
    else if (e.key === 'ArrowUp') { view.y += pan; apply(); }
    else if (e.key === 'ArrowDown') { view.y -= pan; apply(); }
    else return;
    e.preventDefault();
  });
  $('close').addEventListener('click', () => api.close());
  $('edit').addEventListener('click', () => api.edit(current));
  api.onShow(show);
  show(current);
})();
