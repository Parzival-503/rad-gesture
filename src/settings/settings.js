// RadGesture Settings window. Plain DOM, no framework.
// Everything is a draft until Save; the hub writes the files.

(async function () {
  const api = window.rgs;
  const I = window.RGIcons;
  const HK = window.RGHotkeys;
  const KS = window.RGKeyset;
  const G = window.RGGeometry;
  const M = window.RGMenu;
  const T = window.RGThemes;
  const FF = window.RGFnFilter;
  const MD = window.RGMarkdown;
  const RL = window.RGRefLib;
  const $main = document.getElementById('main');

  let D = await api.get();
  // The Functions page's search and filters (src/common/fnfilter.js).
  I.setImages(D.images);
  let menuDraft = clone(D.menu);
  let aiDraft = { ...D.ai };
  let scDraft = { ...D.shortcuts };
  let libDraft = clone(D.libraryValues);
  const dirty = { menu: false, ai: false, shortcuts: false, library: false };
  const ui = { tab: new URLSearchParams(location.search).get('tab') || 'rings', ring: 0, path: [], sel: null, iconQuery: '', iconOpen: false, showKey: false, testResult: null, confirmConvert: false, keyQuery: '', confirmClear: false, libCode: {}, libOpen: {}, fx: null };
  ui.fx = FF.fresh();

  const ACCENTS = ['#8fb0ff', '#c79bff', '#f2b84b', '#5cc8d6', '#5fd38d', '#ff8f8f', '#ff9ec7', '#e6e9f0'];
  const HELPER_ACTIONS = [
    ['proofread', 'Proofread the open report'],
    ['impression', 'Write a short impression'],
    ['oneliner', 'One-liner (choose the kind each time)'],
    ['oneliner:full', 'One-liner: full'],
    ['oneliner:oncologic', 'One-liner: oncologic'],
    ['oneliner:treatment', 'One-liner: treatment timeline'],
    ['prior:add', 'Prior checklist: add the copied prior report'],
    ['prior:checklist', 'Prior checklist: make the checklist'],
    ['prior:clear', 'Prior checklist: empty the list'],
    ['prior:show', 'Show the toolbar (priors and chart text)'],
    ['chart:add', 'One-liner: add the copied chart text'],
    ['chart:clear', 'One-liner: empty the chart text'],
    ['history', 'Proofread history'],
  ];
  const SEARCHES = [
    ['Radiopaedia', 'https://radiopaedia.org/search?q={clipboard}'],
    ['Google', 'https://www.google.com/search?q={clipboard}'],
    ['Google Images', 'https://www.google.com/search?tbm=isch&q={clipboard}'],
    ['PubMed', 'https://pubmed.ncbi.nlm.nih.gov/?term={clipboard}'],
  ];
  const SUGGESTED_ICONS = ['pulmonology', 'gastroenterology', 'neurology', 'cardiology', 'skeleton', 'radiology', 'nephrology', 'stethoscope',
    'menu_book', 'spellcheck', 'summarize', 'short_text', 'checklist', 'history', 'timer', 'search', 'travel_explore', 'public', 'folder_open',
    'description', 'content_paste', 'mic', 'contrast', 'straighten', 'my_location', 'grid_view', 'dashboard', 'key', 'wand_stars', 'stars',
    'image_search', 'local_hospital', 'groups', 'tab', 'apps', 'bolt', 'star', 'favorite', 'bookmark', 'link', 'calculate', 'edit_note'];
  const SHORTCUTS = [
    ['trigger', 'Open the ring', 'Hold it, flick, let go. Tap it to click instead.'],
    ['proofread', 'Proofread', 'In a PowerScribe report.'],
    ['oneliner', 'One-liner', 'On selected text, anywhere.'],
    ['impression', 'Impression', 'Optional. Also on the ring.'],
    ['priorAdd', 'Prior checklist: add prior', 'Optional. Adds the prior report you copied. Also on the ring and toolbar.'],
    ['priorChecklist', 'Prior checklist: make it', 'Optional. Also on the ring and toolbar.'],
    ['chartAdd', 'Add chart text (one-liner)', 'Optional. Adds what you copied to the one-liner\'s chart bin. Also on the ring and toolbar.'],
  ];

  // ------------------------------------------------------------------ utils

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const icon = (name) => h('span', { html: I.icon(name) }).firstChild;
  const msym = (name) => h('span', { class: 'msym' }, name);
  function toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function seg(options, value, onPick) {
    return h('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label, ic]) =>
      h('button', { class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value), onclick: () => onPick(v) }, ic ? msym(ic) : null, label)));
  }
  function sw(on, onFlip, label) {
    return h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label || '', onclick: () => onFlip(!on) });
  }
  function row(label, sub, ...ctl) {
    return h('div', { class: 'row' }, h('div', { class: 'lbl' }, h('b', {}, label), sub ? h('small', {}, sub) : null), h('div', { class: 'ctl' }, ...ctl));
  }
  function markDirty(part) {
    dirty[part] = true;
    renderSaveBar();
  }

  // ------------------------------------------------------------------ menu model helpers

  const curRing = () => menuDraft.categories[ui.ring];
  function levelItems() {
    let items = curRing().items;
    for (const i of ui.path) items = items[i].items;
    return items;
  }
  function levelName() {
    if (!ui.path.length) return curRing().name;
    let items = curRing().items, it = null;
    for (const i of ui.path) {
      it = items[i];
      items = it.items;
    }
    return it.name;
  }
  function actionType(it) {
    if (it.items) return 'ring';
    const a = M.parseAction(it.action) || { kind: 'url', value: '' };
    if (a.kind === 'helper') return a.value.startsWith('keys:') ? 'keys' : a.value.startsWith('lib:') ? 'lib' : 'ai';
    return { url: 'web', file: 'file', search: 'search', hub: 'hub', app: 'app', ref: 'ref' }[a.kind] || 'web';
  }
  function describe(it) {
    if (it.items) return `${it.items.length} inside`;
    const a = M.parseAction(it.action);
    if (!a) return 'no action';
    if (a.kind === 'helper') {
      if (a.value.startsWith('keys:')) return 'presses ' + HK.pretty(sendToHotkey(a.value.slice(5)));
      if (a.value.startsWith('lib:')) { const f = libFn(a.value.slice(4)); return f ? 'library: ' + f.name : 'unknown library function'; }
      const f = HELPER_ACTIONS.find(([id]) => id === a.value);
      return f ? f[1] : a.value;
    }
    if (a.kind === 'url') return a.value.replace(/^https?:\/\//, '').slice(0, 40);
    if (a.kind === 'search') return 'search copied text';
    if (a.kind === 'ref') { const r = refById(a.value); return r ? 'reference: ' + r.title : (refsList ? 'reference (deleted)' : 'reference'); }
    if (a.kind === 'hub' && a.value === 'ref-add') return 'adds the clipboard to the Reference Library';
    if (a.kind === 'file') return a.value.split(/[\\/]/).pop() || a.value;
    if (a.kind === 'app') return 'opens ' + (a.value.split(/[\\/]/).pop() || a.value) + (it.startWithHub ? ' (starts with RadGesture)' : '');
    return a.value;
  }
  // "^!2" / "{F4}" (Send syntax) <-> "^!2" / "F4" (hotkey syntax)
  const sendToHotkey = KS.sendToHotkey;
  const hotkeyToSend = KS.hotkeyToSend;
  function knownHotkeys() {
    const out = [];
    for (const s of D.externalHotkeys.running || []) for (const hk of s.hotkeys) out.push({ key: hk.key, script: s.script, does: hk.does });
    for (const [k, label] of SHORTCUTS) if (scDraft[k]) out.push({ key: scDraft[k], script: 'RadGesture', does: label, field: k });
    for (const f of allFns()) {
      const v = libDraft.values[f.id];
      if (v && v.On === '1' && v.Hotkey) out.push({ key: v.Hotkey, script: 'RadGesture Functions', does: f.name, lib: f.id });
    }
    return out;
  }
  // Built-in functions plus "My functions" (written in Functions), as one list.
  const customAsFn = (c) => ({ id: c.id, name: c.name || 'My function', group: 'My functions', sub: 'Mine', description: c.description || 'Your own script.', icon: 'code', params: [], custom: true });
  const allFns = () => D.library.functions.concat((libDraft.custom || []).map(customAsFn));
  const libFn = (id) => allFns().find((f) => f.id === id);

  // ------------------------------------------------------------------ nav + save bar

  function setTab(t) {
    // "references:<id>" opens the Reference Library on that entry.
    const m = /^references:(r[a-z0-9]+)$/.exec(t || '');
    if (m) { t = 'references'; ui.refSel = 'ref:' + m[1]; refsList = null; ui.refQuery = ''; }
    ui.tab = t;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
  }
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  api.onTab((t) => setTab(t));
  // A report was learned while this window is open: refresh the count.
  api.onStyleChanged(async () => { if (ui.style) { ui.style.list = await api.styleList(); if (ui.tab === 'ai' && !dirty.ai) render(); } });

  const saveBar = h('div', { class: 'savebar' });
  document.body.append(saveBar);
  function renderSaveBar() {
    const parts = Object.entries(dirty).filter(([, v]) => v).map(([k]) => ({ menu: 'rings', ai: 'AI tools', shortcuts: 'shortcuts', library: 'library' })[k]);
    saveBar.innerHTML = '';
    saveBar.classList.toggle('show', parts.length > 0);
    if (!parts.length) return;
    saveBar.append(
      h('span', { class: 'grow' }, `Unsaved changes: ${parts.join(', ')}`),
      h('button', { class: 'btn ghost', onclick: discardAll }, 'Discard'),
      h('button', { class: 'btn primary', id: 'saveAll', onclick: saveAll }, msym('check'), 'Save')
    );
  }
  async function saveAll() {
    if (dirty.menu) {
      const v = M.validateMenu(menuDraft);
      if (!v.ok) {
        toast('Not saved: ' + v.errors[0]);
        return;
      }
      const r = await api.saveMenu(menuDraft);
      if (!r.ok) return toast('Not saved: ' + r.errors[0]);
      dirty.menu = false;
    }
    if (dirty.ai) {
      await api.saveAI(aiDraft);
      dirty.ai = false;
    }
    if (dirty.shortcuts) {
      await api.saveShortcuts(scDraft);
      dirty.shortcuts = false;
    }
    if (dirty.library) {
      await api.saveLibrary(libDraft);
      dirty.library = false;
    }
    D = await api.get();
    I.setImages(D.images);
    libDraft = clone(D.libraryValues);
    renderSaveBar();
    render();
    toast('Saved');
  }
  function discardAll() {
    menuDraft = clone(D.menu);
    aiDraft = { ...D.ai };
    scDraft = { ...D.shortcuts };
    libDraft = clone(D.libraryValues);
    dirty.menu = dirty.ai = dirty.shortcuts = dirty.library = false;
    ui.path = [];
    ui.sel = null;
    ui.ring = Math.min(ui.ring, menuDraft.categories.length - 1);
    renderSaveBar();
    render();
  }
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (Object.values(dirty).some(Boolean)) saveAll();
    }
  });

  // ------------------------------------------------------------------ render

  let lastTab = null;
  function render() {
    T.apply(document.documentElement, menuDraft && menuDraft.theme, 'ui');
    // A re-render on the same page keeps where you were scrolled: the page
    // itself and every list marked data-keep-scroll (Move up / down, a drop,
    // a click in a long list would otherwise jump back to the top).
    const same = ui.tab === lastTab;
    const kept = same ? { main: $main.scrollTop, lists: {} } : null;
    if (kept) $main.querySelectorAll('[data-keep-scroll]').forEach((el) => { kept.lists[el.dataset.keepScroll] = el.scrollTop; });
    $main.innerHTML = '';
    // Fade in only when the page changes, not on every re-render while editing.
    $main.classList.toggle('fresh', ui.tab !== lastTab);
    lastTab = ui.tab;
    const page = { rings: renderRings, ai: renderAI, shortcuts: renderShortcuts, functions: renderLibrary, workflow: renderWorkflow, references: renderReferences, general: renderGeneral, status: renderStatus }[ui.tab] || renderRings;
    page();
    if (kept) {
      $main.querySelectorAll('[data-keep-scroll]').forEach((el) => { const y = kept.lists[el.dataset.keepScroll]; if (y !== undefined) el.scrollTop = y; });
      $main.scrollTop = kept.main;
      // What is selected stays in sight (a moved row can leave the visible part).
      $main.querySelectorAll('[data-keep-scroll]').forEach((el) => {
        const on = el.querySelector('.on');
        if (!on) return;
        const a = el.getBoundingClientRect(), b = on.getBoundingClientRect();
        if (b.top < a.top) el.scrollTop -= a.top - b.top + 8;
        else if (b.bottom > a.bottom) el.scrollTop += b.bottom - a.bottom + 8;
      });
    }
    paintStatusDot();
  }

  function paintStatusDot() {
    const s = D.status;
    const dot = document.getElementById('statusDot');
    dot.className = 'dot ' + (s.helper.connected && !s.conflicts.length ? 'good' : 'bad');
    document.getElementById('ver').textContent = 'v' + s.version;
    document.getElementById('sideFoot').textContent = s.helper.connected
      ? (s.paused ? 'Paused. Ctrl+CapsLock does nothing until you resume.' : 'Ready. Hold Ctrl+CapsLock anywhere.')
      : 'The ring shortcut is not working right now. See Status.';
  }

  // ---------------------------------------------------------------- Rings

  function renderRings() {
    $main.append(
      h('h1', {}, 'Rings'),
      h('p', { class: 'lede' }, 'Each ring is one set of directions; the buttons under the ring (or scrolling) switch between them. Pick a ring, then a direction, and change it on the right.')
    );
    const grid = h('div', { class: 'rings' });
    grid.append(ringList(), levelPanel(), editorPanel());
    $main.append(grid);
  }

  function ringList() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Your rings'));
    const list = h('div', { class: 'list' });
    menuDraft.categories.forEach((c, i) => {
      list.append(h('div', {
        class: 'lrow' + (i === ui.ring ? ' on' : ''), role: 'button', tabindex: '0',
        onclick: () => { ui.ring = i; ui.path = []; ui.sel = 'ring'; render(); },
      },
      h('span', { class: 'ic', style: `color:${T.ringColor(menuDraft, i)}` }, icon(c.icon)),
      h('span', { class: 'tx' }, h('b', {}, c.name), h('small', {}, `${c.items.length} direction${c.items.length === 1 ? '' : 's'}${c.apps && c.apps.length ? ' · first over ' + c.apps.join(', ') : ''}`)),
      h('span', { class: 'tools' },
        h('button', { class: 'iconbtn', title: 'Move up', 'aria-label': 'Move up', onclick: (e) => { e.stopPropagation(); moveRing(i, -1); } }, msym('arrow_upward')),
        h('button', { class: 'iconbtn', title: 'Move down', 'aria-label': 'Move down', onclick: (e) => { e.stopPropagation(); moveRing(i, 1); } }, msym('arrow_downward')))));
    });
    box.append(list, h('div', { class: 'addrow' }, h('button', { class: 'btn', onclick: addRing }, msym('add'), 'New ring')));
    return box;
  }
  function moveRing(i, d) {
    const c = menuDraft.categories;
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    ui.ring = j;
    markDirty('menu');
    render();
  }
  function addRing() {
    menuDraft.categories.push({ id: 'ring-' + Date.now().toString(36), name: 'New ring', color: ACCENTS[menuDraft.categories.length % ACCENTS.length], icon: 'star', items: [{ name: 'New direction', icon: 'public', action: 'url:https://www.google.com' }] });
    ui.ring = menuDraft.categories.length - 1;
    ui.path = [];
    ui.sel = 'ring';
    markDirty('menu');
    render();
  }

  function levelPanel() {
    const ring = curRing();
    const items = levelItems();
    const box = h('div', { class: 'card', style: `--accent:${T.ringColor(menuDraft, ui.ring)}` });
    // breadcrumbs
    const crumbs = h('div', { class: 'crumbs' }, h('button', { onclick: () => { ui.path = []; ui.sel = 'ring'; render(); } }, ring.name));
    let its = ring.items;
    ui.path.forEach((ix, depth) => {
      const it = its[ix];
      crumbs.append(msym('chevron_right'), h('button', { onclick: () => { ui.path = ui.path.slice(0, depth + 1); ui.sel = null; render(); } }, it.name));
      its = it.items;
    });
    box.append(crumbs, miniRing(items));
    // list of directions
    const list = h('div', { class: 'list' });
    items.forEach((it, i) => {
      list.append(h('div', {
        class: 'lrow' + (ui.sel === i ? ' on' : ''), role: 'button', tabindex: '0',
        onclick: () => { ui.sel = i; ui.confirmConvert = false; ui.iconOpen = false; render(); },
        ondblclick: () => { if (it.items) { ui.path.push(i); ui.sel = null; render(); } },
      },
      h('span', { class: 'ic' }, icon(it.icon)),
      h('span', { class: 'tx' }, h('b', {}, it.name), h('small', {}, describe(it))),
      h('span', { class: 'tools' },
        it.items ? h('button', { class: 'iconbtn', title: 'Open this smaller ring', 'aria-label': 'Open', onclick: (e) => { e.stopPropagation(); ui.path.push(i); ui.sel = null; render(); } }, msym('subdirectory_arrow_right')) : null,
        h('button', { class: 'iconbtn', title: 'Move earlier (counter-clockwise)', 'aria-label': 'Move earlier', onclick: (e) => { e.stopPropagation(); moveItem(i, -1); } }, msym('arrow_upward')),
        h('button', { class: 'iconbtn', title: 'Move later (clockwise)', 'aria-label': 'Move later', onclick: (e) => { e.stopPropagation(); moveItem(i, 1); } }, msym('arrow_downward')),
        h('button', { class: 'iconbtn', title: 'Delete', 'aria-label': 'Delete', onclick: (e) => { e.stopPropagation(); deleteItem(i); } }, msym('delete')))));
    });
    if (!items.length) list.append(h('div', { class: 'empty' }, 'No directions yet.'));
    const full = items.length >= M.MAX_ITEMS;
    box.append(list, h('div', { class: 'addrow' },
      h('button', { class: 'btn', disabled: full, onclick: () => addItem(false) }, msym('add'), 'Add direction'),
      h('button', { class: 'btn', disabled: full, onclick: () => addItem(true) }, msym('donut_small'), 'Add smaller ring'),
      h('button', { class: 'btn ghost', onclick: () => api.tryRing(menuDraft) }, msym('play_circle'), 'Try it'),
      full ? h('span', { class: 'hint' }, `A ring holds at most ${M.MAX_ITEMS} directions.`) : null));
    return box;
  }

  function miniRing(items) {
    const box = h('div', { class: 'mini' });
    const W = 280, cx = 140, cy = 136, R = 92;
    box.style.width = W + 'px';
    box.style.margin = '4px auto 14px';
    const back = ui.path.length ? G.norm(180) : null;
    const slots = G.slotAngles(Math.max(1, items.length), back);
    const c = h('div', { class: 'c', style: `left:${cx}px;top:${cy}px`, title: 'Ring settings', onclick: () => { ui.sel = 'ring'; render(); } }, icon(ui.path.length ? (levelParentItem() || {}).icon : curRing().icon), h('span', {}, levelName()));
    box.append(c);
    if (back !== null) {
      const p = G.polar(cx, cy, back, R * 0.72);
      box.append(h('div', { class: 'n back', title: 'Back', style: `left:${p.x}px;top:${p.y}px`, onclick: () => { ui.path.pop(); ui.sel = null; render(); } }, msym('arrow_back')));
    }
    const pts = items.map((it, i) => G.polar(cx, cy, slots.items[i], R));
    items.forEach((it, i) => {
      const p = pts[i];
      box.append(h('div', { class: 'n' + (ui.sel === i ? ' on' : ''), title: it.name, style: `left:${p.x}px;top:${p.y}px`, onclick: () => { ui.sel = i; render(); } }, icon(it.icon)));
      // Each name sits on one line above or under its own button (the column
      // is too narrow for names beside them): above in the upper half, else
      // under, unless that spot runs into another button or the center, as a
      // long name under a side button can with seven directions.
      const w = Math.min(84, it.name.length * 6.2 + 4);
      const hits = (top) => pts.some((q, j) => j !== i && Math.abs(q.x - p.x) < w / 2 + 23 && top < q.y + 23 && top + 14 > q.y - 23) ||
        (Math.abs(cx - p.x) < w / 2 + 42 && top < cy + 42 && top + 14 > cy - 42);
      const spots = p.y < cy - 10 ? [p.y - 41, p.y + 27] : [p.y + 27, p.y - 41];
      const top = spots.find((t) => !hits(t)) ?? spots[0];
      box.append(h('div', { class: 't', title: it.name, style: `left:${p.x}px;top:${top}px` }, it.name));
    });
    return box;
  }
  function levelParentItem() {
    let items = curRing().items, it = null;
    for (const i of ui.path) { it = items[i]; items = it.items; }
    return it;
  }
  function moveItem(i, d) {
    const items = levelItems();
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    ui.sel = j;
    markDirty('menu');
    render();
  }
  function deleteItem(i) {
    const items = levelItems();
    if (items.length <= 1) return toast('A ring needs at least one direction. Delete the ring instead.');
    items.splice(i, 1);
    ui.sel = null;
    markDirty('menu');
    render();
  }
  function addItem(asRing) {
    const items = levelItems();
    items.push(asRing
      ? { name: 'New group', icon: 'folder', items: [{ name: 'New direction', icon: 'public', action: 'url:https://www.google.com' }] }
      : { name: 'New direction', icon: 'public', action: 'url:https://www.google.com' });
    ui.sel = items.length - 1;
    markDirty('menu');
    render();
  }

  // ---- right-hand editor ----
  function editorPanel() {
    const box = h('div', { class: 'card editor' });
    if (ui.sel === 'ring' || ui.sel === null) {
      if (ui.path.length && ui.sel === null) {
        box.append(h('div', { class: 'empty' }, 'Pick a direction to change it, or click the center of the preview to rename this smaller ring.'));
        return box;
      }
      return ringEditor(box);
    }
    const items = levelItems();
    const it = items[ui.sel];
    if (!it) return box;
    box.append(h('h2', {}, 'Direction'));
    box.append(field('Name', h('input', { type: 'text', id: 'itemName', value: it.name, oninput: (e) => { it.name = e.target.value; markDirty('menu'); refreshLists(); } })));
    box.append(field('Icon', iconPicker(it.icon, (v) => { it.icon = v; markDirty('menu'); render(); })));
    const type = actionType(it);
    const types = [['ai', 'AI tool', 'stars'], ['lib', 'Function', 'functions'], ['ref', 'Reference', 'menu_book'], ['app', 'Open a program', 'apps'], ['web', 'Website', 'public'], ['search', 'Search copied text', 'search'], ['file', 'File or folder', 'folder_open'], ['keys', 'Press keys', 'keyboard'], ['ring', 'Smaller ring', 'donut_small']];
    box.append(field('What it does', seg(types, type, (t) => changeType(it, t))));
    box.append(typeFields(it, type));
    return box;
  }
  function field(label, ctl, hint) {
    return h('div', { class: 'field' }, h('label', {}, label), ctl, hint ? h('div', { class: 'hint', style: 'margin-top:6px' }, hint) : null);
  }
  function refreshLists() {
    // Cheap live refresh of names without losing focus in the editor.
    const items = levelItems();
    document.querySelectorAll('.rings .card:nth-child(2) .lrow').forEach((r, i) => {
      if (items[i]) r.querySelector('b').textContent = items[i].name;
    });
  }
  function changeType(it, t) {
    const from = actionType(it);
    if (t === from) return;
    if (from === 'ring' && it.items && it.items.length && !ui.confirmConvert) {
      ui.confirmConvert = t;
      render();
      return;
    }
    ui.confirmConvert = false;
    if (t === 'ring') {
      delete it.action;
      it.items = [{ name: 'New direction', icon: 'public', action: 'url:https://www.google.com' }];
    } else {
      delete it.items;
      if (t !== 'app') ['args', 'ifRunning', 'startWithHub'].forEach((k) => delete it[k]);
      it.action = { app: 'app:notepad.exe', ai: 'helper:proofread', web: 'url:https://www.google.com', search: 'search:' + SEARCHES[0][1], file: 'file:%USERPROFILE%\\Documents', keys: 'helper:keys:{F4}', lib: 'helper:lib:PACS_WL_SoftTissue', ref: 'ref:' + (((refsList || [])[0] || {}).id || 'rnone0') }[t];
    }
    markDirty('menu');
    render();
  }
  function typeFields(it, type) {
    const box = h('div', {});
    const a = M.parseAction(it.action) || { kind: '', value: '' };
    const set = (v) => { it.action = v; markDirty('menu'); refreshLists(); };
    if (ui.confirmConvert) {
      box.append(h('div', { class: 'card', style: 'background:#2a2414;border-color:#5a4a1c' },
        h('div', { class: 'warnline' }, msym('warning'), `This removes the ${it.items.length} direction(s) inside it.`),
        h('div', { class: 'addrow' },
          h('button', { class: 'btn danger', onclick: () => {
            const t = ui.confirmConvert;
            ui.confirmConvert = false;
            delete it.items;
            it.action = 'url:https://www.google.com'; // a plain direction for a moment...
            if (t !== 'web') changeType(it, t); // ...then the type that was asked for
            markDirty('menu');
            render();
          } }, 'Remove them and change'),
          h('button', { class: 'btn ghost', onclick: () => { ui.confirmConvert = false; render(); } }, 'Keep it'))));
      return box;
    }
    if (type === 'ai') {
      const sel = h('select', { class: 'wide', onchange: (e) => { set('helper:' + e.target.value); } },
        HELPER_ACTIONS.map(([id, label]) => h('option', { value: id, selected: a.value === id }, label)));
      box.append(field('Tool', sel, 'Runs in the active window, the moment you let go.'));
    } else if (type === 'lib') {
      const id = a.value.replace(/^lib:/, '');
      const sel = h('select', { class: 'wide', id: 'libPick', onchange: (e) => { set('helper:lib:' + e.target.value); render(); } },
        D.library.groups.concat(libDraft.custom && libDraft.custom.length ? ['My functions'] : []).map((g) => h('optgroup', { label: g },
          allFns().filter((f) => f.group === g).map((f) => h('option', { value: f.id, selected: f.id === id }, `${f.name}  (${f.sub})`)))));
      const f = libFn(id);
      box.append(field('Function', sel, f ? f.description : 'Pick a function.'));
      if (f) box.append(libKeyNote(f, true));
    } else if (type === 'ref') {
      if (!refsList) { loadRefs().then(() => render()); box.append(h('div', { class: 'hint' }, 'Loading...')); return box; }
      const id = a.value;
      if (!refsList.length) box.append(h('div', { class: 'hint' }, 'The Reference Library is empty. Add a note or screenshot in References first.'));
      else box.append(field('Reference', h('select', { class: 'wide', id: 'refPickRing', onchange: (e) => { set('ref:' + e.target.value); render(); } },
        refsList.map((r) => h('option', { value: r.id, selected: r.id === id }, (r.image ? '[picture] ' : '') + r.title))), 'Opens in a clean window over what you are reading. Edit it in Reference Library.'));
    } else if (type === 'web') {
      box.append(field('Address', h('input', { type: 'url', value: a.value, placeholder: 'https://', oninput: (e) => set('url:' + e.target.value.trim()) })));
    } else if (type === 'search') {
      const cur = a.value;
      box.append(field('Search on', seg(SEARCHES.map(([n, u]) => [u, n]), SEARCHES.some(([, u]) => u === cur) ? cur : '', (u) => { set('search:' + u); render(); })));
      box.append(field('Address', h('input', { type: 'text', value: cur, oninput: (e) => set('search:' + e.target.value.trim()) }), '{clipboard} is replaced by the text you copied.'));
    } else if (type === 'file') {
      const input = h('input', { type: 'text', value: a.value, oninput: (e) => set('file:' + e.target.value.trim()) });
      box.append(field('File or folder', input));
      box.append(h('div', { class: 'addrow', style: 'margin-top:-6px;margin-bottom:12px' },
        h('button', { class: 'btn small', onclick: async () => { const p = await api.pickFile('file'); if (p) { set('file:' + p); render(); } } }, msym('description'), 'Choose a file'),
        h('button', { class: 'btn small', onclick: async () => { const p = await api.pickFile('folder'); if (p) { set('file:' + p); render(); } } }, msym('folder_open'), 'Choose a folder')));
    } else if (type === 'keys') {
      const spec = sendToHotkey(a.value.replace(/^keys:/, ''));
      const handlers = HK.clashes(spec, knownHotkeys());
      box.append(field('Keys to press', recorder(spec, (v) => { set('helper:keys:' + hotkeyToSend(v)); render(); }, { plain: true }),
        handlers.length ? `Handled by ${handlers.map((x) => `${x.script}: ${x.does}`).join('; ')}.` : 'No script of yours handles this; it goes straight to the active window.'));
    } else if (type === 'app') {
      // A program, shortcut, AutoHotkey script or batch file (a timer,
      // Epic...). The helper starts it, or brings its window
      // to the front when it is already open.
      box.append(field('Program', h('input', { type: 'text', id: 'appPath', value: a.value, placeholder: 'C:\\...\\Program.exe', oninput: (e) => set('app:' + e.target.value.trim()) }),
        'A program (.exe), a shortcut (.lnk), an AutoHotkey script (.ahk) or a batch file.'));
      box.append(h('div', { class: 'addrow', style: 'margin-top:-6px;margin-bottom:12px' },
        h('button', { class: 'btn small', id: 'pickProgram', onclick: async () => {
          const r = await api.pickProgram();
          if (!r.ok) return;
          if (r.images) I.setImages(r.images), (D.images = r.images);
          it.action = 'app:' + r.path;
          if (!it.name || it.name === 'New direction') it.name = r.name;
          if (r.icon) it.icon = r.icon; // the program's own icon; change it after if you like
          markDirty('menu');
          render();
        } }, msym('folder_open'), 'Choose...'),
        r0Icon(it)));
      box.append(field('Options (optional)', h('input', { type: 'text', value: it.args || '', placeholder: 'e.g. a file to open with it', oninput: (e) => { const v = e.target.value; if (v.trim()) it.args = v; else delete it.args; markDirty('menu'); } })));
      box.append(field('If it is already open', seg([['front', 'Bring it to the front'], ['new', 'Open another copy']], it.ifRunning === 'new' ? 'new' : 'front', (v) => { if (v === 'new') it.ifRunning = 'new'; else delete it.ifRunning; markDirty('menu'); render(); }),
        'Scripts (.ahk) that are already running are left alone either way.'));
      box.append(field('Start it with RadGesture', h('div', { class: 'addrow', style: 'margin:0;align-items:center' },
        sw(!!it.startWithHub, (v) => { if (v) it.startWithHub = true; else delete it.startWithHub; markDirty('menu'); render(); }, 'Start it with RadGesture'),
        h('span', { class: 'hint' }, 'Starts it (if it is not running) every time RadGesture starts, e.g. a timer or your own shortcut script.'))));
    } else if (type === 'ring') {
      box.append(h('div', { class: 'addrow' }, h('button', { class: 'btn', onclick: () => { ui.path.push(ui.sel); ui.sel = null; render(); } }, msym('subdirectory_arrow_right'), `Open it (${it.items.length} inside)`)));
    }
    if (type !== 'ring') {
      // Previous / next and the like are pressed again and again.
      box.append(field('Keep the ring open after using it', h('div', { class: 'addrow', style: 'margin:0;align-items:center' },
        sw(!!it.stay, (v) => { it.stay = v; markDirty('menu'); render(); }, 'Keep the ring open after using it'),
        h('span', { class: 'hint' }, 'For things you press again and again (previous / next): the ring stays up until you press Esc or click outside it.'))));
    }
    return box;
  }
  // "Use the program's own icon" when it has one and the direction shows another.
  function r0Icon(it) {
    const a = M.parseAction(it.action);
    if (!a || a.kind !== 'app') return null;
    return h('button', { class: 'btn small ghost', title: 'Use the program\'s own icon', onclick: async () => {
      const r = await api.programIcon(a.value);
      if (r && r.icon) { I.setImages(r.images); D.images = r.images; it.icon = r.icon; markDirty('menu'); render(); }
      else toast('No icon found for that program.');
    } }, msym('image'), 'Use its icon');
  }

  function ringEditor(box) {
    const ring = curRing();
    if (ui.path.length) {
      const it = levelParentItem();
      box.append(h('h2', {}, 'Smaller ring'));
      box.append(field('Name', h('input', { type: 'text', value: it.name, oninput: (e) => { it.name = e.target.value; markDirty('menu'); } })));
      box.append(field('Icon', iconPicker(it.icon, (v) => { it.icon = v; markDirty('menu'); render(); })));
      return box;
    }
    box.append(h('h2', {}, 'Ring'));
    box.append(field('Name', h('input', { type: 'text', id: 'ringName', value: ring.name, oninput: (e) => { ring.name = e.target.value; markDirty('menu'); } })));
    box.append(field('Icon', iconPicker(ring.icon, (v) => { ring.icon = v; markDirty('menu'); render(); })));
    if (T.usesThemeColors(menuDraft)) {
      box.append(field('Colour', h('div', { class: 'hint' }, `The ${T.get(menuDraft.theme).name} theme colours the rings. `,
        h('button', { class: 'linkbtn', onclick: () => { menuDraft.ringColors = 'mine'; markDirty('menu'); render(); } }, 'Use my own colours'))));
    } else {
      box.append(field('Colour', h('div', { class: 'colors' }, ACCENTS.map((c) => h('button', { class: c === ring.color ? 'on' : '', style: `background:${c}`, 'aria-label': c, onclick: () => { ring.color = c; markDirty('menu'); render(); } })))));
    }
    box.append(field('Opens first over', h('input', { type: 'text', value: (ring.apps || []).join(', '), placeholder: 'e.g. Nuance.PowerScribe360.exe',
      oninput: (e) => { ring.apps = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); markDirty('menu'); } }),
    'Program names. When you open the ring over one of these, this ring comes up first.'));
    box.append(h('div', { class: 'addrow' }, h('button', { class: 'btn danger', disabled: menuDraft.categories.length <= 1, onclick: () => {
      menuDraft.categories.splice(ui.ring, 1);
      ui.ring = Math.max(0, ui.ring - 1);
      ui.sel = 'ring';
      markDirty('menu');
      render();
    } }, msym('delete'), 'Delete this ring')));
    return box;
  }

  // Icons from four places: Material Symbols, Tabler Icons (both bundled),
  // emoji, and pictures of your own (or programs' icons) kept in
  // %APPDATA%\RadGesture\icons.
  const PACKS = [['material', 'Material', 'interests'], ['tabler', 'Tabler', 'category'], ['emoji', 'Emoji', 'mood'], ['mine', 'My pictures', 'photo_library']];
  const SUGGESTED_TABLER = ['lungs', 'brain', 'heart', 'bone', 'skull', 'stethoscope', 'microscope', 'radioactive', 'scan', 'ruler-measure',
    'crosshair', 'zoom-in', 'contrast', 'layout-grid', 'photo', 'book', 'notebook', 'clipboard-text', 'checklist', 'clipboard-check', 'file-text',
    'search', 'world', 'folder', 'keyboard', 'player-play', 'player-stop', 'clock', 'stopwatch', 'brand-teams', 'brand-chrome', 'message',
    'bolt', 'star', 'bookmark', 'link', 'calculator', 'pencil', 'microphone', 'users', 'building-hospital', 'apps'];
  const SUGGESTED_EMOJI = ['🫁', '🧠', '❤️', '🦴', '🩻', '🩺', '🔬', '☢️', '📏', '🎯', '📋', '✅', '📝', '📚', '🔍', '🌐', '📁', '⏱️', '▶️', '⏹️', '💬', '⭐', '⚡', '🔗', '🧮', '🎤', '👥', '🏥'];
  function iconPicker(cur, onPick) {
    const wrap = h('div', {});
    const r = I.resolve(cur);
    const curPack = { symbol: 'material', tabler: 'tabler', text: 'emoji', image: 'mine' }[r.kind] || 'material';
    if (!ui.iconPack) ui.iconPack = curPack;
    const label = r.kind === 'image' ? 'your picture' : r.kind === 'tabler' ? 'Tabler: ' + r.value : r.value;
    wrap.append(h('div', { class: 'iconpick' },
      h('span', { class: 'cur' }, icon(cur)),
      h('button', { class: 'btn small', id: 'changeIcon', onclick: () => { ui.iconOpen = !ui.iconOpen; ui.iconPack = curPack; render(); } }, msym('palette'), ui.iconOpen ? 'Close' : 'Change'),
      h('span', { class: 'hint' }, label)));
    if (!ui.iconOpen) return wrap;
    const pick = (v) => { onPick(v); ui.iconOpen = false; };
    const grid = h('div', { class: 'icongrid' });
    const q = h('input', { type: 'text', id: 'iconSearch', value: ui.iconQuery, style: 'width:100%;margin-top:8px',
      oninput: (e) => { ui.iconQuery = e.target.value; paintGrid(); } });
    const tabs = h('div', { class: 'seg packs', style: 'margin-top:8px' }, PACKS.map(([id, name, ic]) =>
      h('button', { class: ui.iconPack === id ? 'on' : '', 'data-pack': id, onclick: () => { ui.iconPack = id; render(); } }, msym(ic), name)));
    const paintGrid = () => {
      grid.innerHTML = '';
      const query = ui.iconQuery.trim().toLowerCase();
      const btn = (value, html, title) => {
        const b = h('button', { class: value === cur ? 'on' : '', title, onclick: () => pick(value) });
        b.innerHTML = html;
        grid.append(b);
      };
      const none = (t) => grid.append(h('div', { class: 'hint', style: 'grid-column:1/-1;padding:8px' }, t));
      if (ui.iconPack === 'material') {
        const words = query.replace(/[ -]/g, '_');
        const list = query ? D.iconNames.filter((n) => n.includes(words)).slice(0, 200) : SUGGESTED_ICONS;
        list.forEach((n) => btn(n, I.icon(n), n));
        if (!list.length) none('No Material icon by that name. Try the Tabler tab.');
      } else if (ui.iconPack === 'tabler') {
        const words = query.replace(/[ _]/g, '-');
        const list = query ? I.tablerNames().filter((n) => n.includes(words)).slice(0, 200) : SUGGESTED_TABLER;
        list.forEach((n) => btn('ti:' + n, I.icon('ti:' + n), n));
        if (!list.length) none('No Tabler icon by that name. Try the Material tab.');
      } else if (ui.iconPack === 'emoji') {
        if (query && !/^[a-z0-9_ -]+$/.test(query)) btn(ui.iconQuery.trim(), I.icon(ui.iconQuery.trim()), 'Use this');
        SUGGESTED_EMOJI.forEach((e) => btn(e, I.icon(e), e));
      } else {
        grid.append(h('button', { class: 'addpic', id: 'addPicture', title: 'Add a picture', onclick: async () => {
          const res = await api.importIcon();
          if (res.ok) { I.setImages(res.images); D.images = res.images; pick(res.icon); render(); }
          else if (!res.canceled) toast(res.error);
        } }, msym('add_photo_alternate')));
        Object.keys(D.images || {}).forEach((f) => btn('img:' + f, I.icon('img:' + f), f.startsWith('app-') ? 'a program\'s icon' : 'your picture'));
      }
    };
    q.placeholder = { material: 'Search Material icons (e.g. lung, brain, book)', tabler: 'Search Tabler icons (e.g. lungs, scan, ruler)', emoji: 'Paste or type any emoji', mine: 'Your pictures and programs\' icons' }[ui.iconPack];
    q.style.display = ui.iconPack === 'mine' ? 'none' : '';
    paintGrid();
    wrap.append(tabs, q, grid);
    if (ui.iconPack === 'mine') wrap.append(h('div', { class: 'hint', style: 'margin-top:6px' }, 'PNG, JPG, SVG, ICO, WEBP or GIF. Kept on this PC, also after updates.'));
    setTimeout(() => q.focus(), 0);
    return wrap;
  }

  // ---------------------------------------------------------------- key recorder
  //
  // Click, then press the keys. While modifiers are held they show live
  // ("Ctrl + Alt + ..."); the first real key completes it. Esc cancels,
  // Backspace on its own clears. { plain: true } (keys the ring presses into
  // Sectra) also takes a single key; a RadGesture shortcut needs Ctrl, Alt,
  // Shift or Win (or an F-key) so it can't fire while typing. The helper is
  // paused while recording so the keys don't trigger anything.

  let listening = null;
  function kbds(spec) {
    const keys = spec ? HK.pretty(spec).split('+') : [];
    return keys.length ? h('span', { class: 'keys' }, keys.map((k) => h('kbd', {}, k))) : h('span', { class: 'ph' }, 'Not set');
  }
  function recorder(spec, onSet, opts = {}) {
    const el = h('button', { class: 'recorder', type: 'button', title: 'Click, then press the keys' },
      kbds(spec), h('span', { class: 'rec' }, msym('keyboard'), 'Record'));
    el.addEventListener('click', () => startListening(el, onSet, opts));
    return el;
  }
  function paintListening(mods) {
    const el = listening.el;
    el.innerHTML = '';
    el.append(
      mods.length ? h('span', { class: 'keys' }, mods.map((m) => h('kbd', {}, m)), h('span', { class: 'ph' }, '+ ...'))
        : h('span', { class: 'ph' }, listening.opts.plain ? 'Press a key or combination...' : 'Press Ctrl/Alt/Shift + a key...'),
      h('span', { class: 'rec live' }, h('i', { class: 'pulse' }), 'Esc cancels'));
  }
  function startListening(el, onSet, opts) {
    stopListening(true);
    listening = { el, onSet, opts };
    el.classList.add('listening');
    paintListening([]);
    api.runHelperAction('suspend'); // so the helper doesn't act on the keys being recorded
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
  }
  function stopListening(quiet) {
    if (!listening) return;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    api.runHelperAction('resume');
    listening = null;
  }
  function onBlur() {
    stopListening();
    render();
  }
  function onKeyUp(e) {
    if (!listening) return;
    e.preventDefault();
    paintListening(HK.heldMods(e));
  }
  function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const plainKey = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.key === 'Escape' && plainKey) {
      stopListening();
      render();
      return;
    }
    const cb = listening.onSet;
    if (e.key === 'Backspace' && plainKey) {
      stopListening();
      cb('');
      return;
    }
    const spec = HK.fromEvent(e, { plain: listening.opts.plain });
    if (!spec) {
      paintListening(HK.heldMods(e)); // only modifiers so far
      return;
    }
    stopListening();
    cb(spec);
  }

  // ---------------------------------------------------------------- AI tools

  function renderAI() {
    $main.append(h('h1', {}, 'AI tools'), h('p', { class: 'lede' }, 'Proofread, Impression, One-liner and the Prior checklist all use these settings.'));
    const a = aiDraft;
    const keyInput = h('input', { type: ui.showKey ? 'text' : 'password', id: 'apiKey', class: 'wide', value: a.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off', spellcheck: 'false',
      oninput: (e) => { a.apiKey = e.target.value.trim(); ui.testResult = null; markDirty('ai'); } });
    const models = D.models;
    const test = ui.testResult;
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Claude'),
      row('API key', 'Stored only on this PC.', keyInput,
        h('button', { class: 'iconbtn', title: ui.showKey ? 'Hide' : 'Show', 'aria-label': 'Show or hide the key', onclick: () => { ui.showKey = !ui.showKey; render(); } }, msym(ui.showKey ? 'visibility_off' : 'visibility'))),
      row('Model', 'Sonnet catches subtle errors best; Haiku is cheaper.',
        h('select', { id: 'model', onchange: (e) => { a.model = e.target.value; markDirty('ai'); } }, models.map((m) => h('option', { value: m, selected: m === a.model }, (D.modelLabels && D.modelLabels[m]) || m)))),
      row('Check the key', null,
        h('button', { class: 'btn', id: 'testKey', onclick: async () => { ui.testResult = { pending: true }; render(); ui.testResult = await api.testKey(a.apiKey, a.model); render(); } }, msym('bolt'), 'Test now'),
        test ? (test.pending ? h('span', { class: 'chip' }, 'Checking...') : test.ok ? h('span', { class: 'chip good' }, msym('check_circle'), 'The key works') : h('span', { class: 'chip bad' }, msym('error'), test.error)) : null)));
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Proofread'),
      row('How picky', 'Higher catches more, with more false alarms.',
        seg([['conservative', 'Only clear errors'], ['moderate', 'Balanced'], ['aggressive', 'Flag anything odd']], a.sensitivity, (v) => { a.sensitivity = v; markDirty('ai'); render(); }))));
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Impression'),
      row('Model', 'Writes a short synthesis, not a summary. Opus thinks harder and costs more per impression.',
        seg([['', 'Same as above'], ['claude-opus-5-5', 'Opus 5.5']], a.impressionModel === 'claude-opus-5-5' ? 'claude-opus-5-5' : '', (v) => { a.impressionModel = v; markDirty('ai'); render(); })),
      row('Your rules', 'Added to every impression, and they win over the built-in rules.',
        h('textarea', { class: 'wide', id: 'rules', rows: 3, oninput: (e) => { a.impressionRules = e.target.value; markDirty('ai'); } }, a.impressionRules))));
    $main.append(styleCard(a));
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Prior checklist'),
      h('p', { class: 'hint', style: 'margin:-6px 0 8px' }, 'A short list of what to check on today\'s study, from the prior reports. Highlight a prior report, press Add prior (repeat for each prior), then Checklist. Each prior\'s exam date is read from the top of the report, so the checklist goes by the newest status of each finding and marks what has resolved. Empty the list starts over. On the ring under AI Tools > Prior checklist, and on the toolbar. Not the same as Insert priors on the PACS ring, which fills PowerScribe\'s Comparison field.'),
      row('Forget priors after', 'Stops one patient\'s priors reaching the next checklist.',
        h('input', { type: 'number', min: 0, max: 240, style: 'width:90px', value: a.priorExpireMinutes, oninput: (e) => { a.priorExpireMinutes = String(Math.max(0, parseInt(e.target.value || '0', 10))); markDirty('ai'); } }),
        h('span', { class: 'hint' }, 'minutes idle (0 = never)')),
      row('Add prior and Add chart text take', 'RadGesture presses Ctrl+C in the window you are in, so highlighting is enough (it works where there is no right-click Copy, as in Sectra). With nothing highlighted, they take what you last copied.',
        seg([['clipboard', 'Highlighted text, or what I copied'], ['selectall', 'Select all + copy']], a.priorCapture, (v) => { a.priorCapture = v; markDirty('ai'); render(); })),
      row('Show the toolbar at startup', 'The small window with the prior checklist, the one-liner\'s chart text, Impression and One-liner.', sw(a.toolbarAtStartup === '1', (v) => { a.toolbarAtStartup = v ? '1' : '0'; markDirty('ai'); render(); }, 'Show toolbar at startup'))));
  }

  // The radiologist's own impressions, which Impression copies the style of.
  // Learned from each report proofread (findings + the impression signed),
  // from "Learn this impression" on the ring, or from reports imported here.
  function styleCard(a) {
    if (!ui.style) {
      ui.style = { list: null, paste: false, open: false, all: false };
      api.styleList().then((l) => { ui.style.list = l; render(); });
    }
    const st = ui.style;
    const list = st.list || [];
    const kinds = {};
    for (const x of list) kinds[x.kind || 'other'] = (kinds[x.kind || 'other'] || 0) + 1;
    const top = Object.entries(kinds).sort((x, y) => y[1] - x[1]).slice(0, 8);
    const reload = async (msg) => { st.list = await api.styleList(); render(); if (msg) toast(msg); };
    const said = (r) => (r.canceled ? null : `Added ${r.added} report${r.added === 1 ? '' : 's'}` + (r.skipped ? ` (${r.skipped} had no FINDINGS and IMPRESSION, skipped)` : '') + `. ${r.count} examples now.`);
    const src = { proofread: 'proofread', manual: 'saved from the ring', import: 'imported' };
    const shown = list.slice().reverse().slice(0, st.all ? list.length : 30);
    return h('div', { class: 'card', id: 'styleCard' },
      h('h2', {}, 'Your impression style'),
      h('p', { class: 'hint', style: 'margin:-6px 0 8px' }, 'Impression learns how you write impressions from your own signed reports, then writes new ones the same way: your wording, length, and what you leave out. Before each impression it picks your closest examples (same kind of study first). Kept on this PC only, without the patient header; dates and long numbers are blanked out.'),
      row('Write in my style', 'Uses your examples in every impression.', sw(a.styleUse !== '0', (v) => { a.styleUse = v ? '1' : '0'; markDirty('ai'); render(); }, 'Write in my style')),
      row('Learn from reports I proofread', 'Each time you proofread a finished report, its findings and your impression become an example. Proofread right before signing, so the impression is the one you sign.', sw(a.styleLearn !== '0', (v) => { a.styleLearn = v ? '1' : '0'; markDirty('ai'); render(); }, 'Learn from reports I proofread')),
      row('Examples', st.list === null ? 'Loading...' : list.length ? null : 'None yet. Proofread a few finished reports, or import some below.',
        h('span', { class: 'chip' + (list.length ? ' good' : ''), id: 'styleCount' }, msym('school'), `${list.length} saved`),
        ...top.map(([k, n]) => h('span', { class: 'chip' }, `${k} ${n}`))),
      row('Add many at once', 'Open several of your signed reports in PowerScribe, copy each one, and paste them here one after another (or import a text file). Each needs FINDINGS: and IMPRESSION:.',
        h('button', { class: 'btn small', id: 'stylePaste', onclick: () => { st.paste = !st.paste; render(); } }, msym('content_paste'), 'Paste reports...'),
        h('button', { class: 'btn small', id: 'styleImportFile', onclick: async () => { const r = await api.styleImportFile(); const m = said(r); if (m) reload(m); } }, msym('upload_file'), 'Import a text file...'),
        list.length ? h('button', { class: 'btn small', id: 'styleClear', onclick: async () => { if (!confirm(`Delete all ${list.length} examples? Impression goes back to the built-in style.`)) return; await api.styleClear(); reload('All examples deleted.'); } }, msym('delete_sweep'), 'Delete all') : null),
      st.paste ? h('div', { class: 'stylepaste' },
        h('textarea', { class: 'wide', id: 'stylePasteText', rows: 8, placeholder: 'EXAMINATION: ...\nFINDINGS: ...\nIMPRESSION: ...\n\nEXAMINATION: ...' }),
        h('div', { class: 'addrow' },
          h('button', { class: 'btn', id: 'stylePasteAdd', onclick: async () => { const t = document.getElementById('stylePasteText').value; const r = await api.styleImport(t); st.paste = !r.added; reload(said(r)); } }, msym('add'), 'Add these'),
          h('span', { class: 'hint' }, 'Use reports you wrote. Anything identifying in the findings themselves (a name typed into the text) is not removed.'))) : null,
      list.length ? h('details', { class: 'stylelist', open: st.open, ontoggle: (e) => { st.open = e.target.open; } },
        h('summary', {}, `See the examples (${list.length})`),
        ...shown.map((x) => h('div', { class: 'styleex', 'data-id': x.id },
          h('div', { class: 'styleexh' },
            h('b', {}, x.exam || x.kind || 'Report'),
            h('span', { class: 'hint' }, `${src[x.source] || x.source}, ${String(x.added || '').slice(0, 10)}`),
            h('button', { class: 'iconbtn', title: 'Delete this example', 'aria-label': 'Delete this example', onclick: async () => { await api.styleRemove(x.id); reload(); } }, msym('delete'))),
          x.draft ? h('div', { class: 'styledraft' }, h('span', { class: 'hint' }, 'AI wrote: '), x.draft) : null,
          h('div', { class: 'styleimp' }, x.draft ? h('span', { class: 'hint' }, 'You signed: ') : null, x.impression))),
        !st.all && list.length > shown.length ? h('button', { class: 'btn small', onclick: () => { st.all = true; render(); } }, `Show all ${list.length}`) : null) : null);
  }

  // ---------------------------------------------------------------- Shortcuts
  //
  // Everything a key does, in one place: RadGesture's own shortcuts, and every
  // key a ring direction presses (into Sectra, PowerScribe, ...).
  // A colleague sets the keys up in Sectra, matches them here, or imports a
  // set someone exported.

  function renderShortcuts() {
    $main.append(h('h1', {}, 'Shortcuts'),
      h('p', { class: 'lede' }, 'Every key RadGesture listens for or presses, in one place. Click a key, then press the new one.'));
    $main.append(setupCard(), ownShortcutsCard(), ringKeysCard());
  }

  function setupCard() {
    const step = (n, icon, title, text, ...btns) => h('div', { class: 'step' },
      h('div', { class: 'stepn' }, String(n)),
      h('div', { class: 'stepb' }, h('b', {}, msym(icon), title), h('p', {}, text), btns.length ? h('div', { class: 'addrow' }, ...btns) : null));
    return h('div', { class: 'card setup' },
      h('h2', {}, 'Setting up on a new workstation'),
      h('div', { class: 'steps3' },
        step(1, 'settings_applications', 'Give the tools keys in Sectra',
          'In Sectra\'s keyboard shortcut settings, give each tool you want a key (Sectra\'s own keys work too). Most PACS directions are Functions: their keys are on the Functions page. This list is for "Press keys" directions.',
          h('button', { class: 'btn small', id: 'copyKeyList', onclick: copyKeyList }, msym('content_copy'), 'Copy the list')),
        step(2, 'keyboard', 'Match them here',
          'Under "Keys the ring presses", click each one and press the key you gave it in Sectra. Single keys are fine.'),
        step(3, 'ios_share', 'Share your setup',
          'Export a file colleagues can import (ring keys, shortcuts, the Functions\' keys and your own functions; never your username), so they only do steps 1-2 once per department.',
          h('button', { class: 'btn small', id: 'exportKeys', onclick: exportKeys }, msym('upload'), 'Export...'),
          h('button', { class: 'btn small', id: 'importKeys', onclick: importKeys }, msym('download'), 'Import...'))));
  }

  async function copyKeyList() {
    await api.copyText(KS.cheatSheet(menuDraft));
    toast('Copied. Paste it anywhere to keep it next to Sectra.');
  }
  async function exportKeys() {
    const set = KS.exportSet(menuDraft, scDraft, libDraft.values);
    set.functions = (libDraft.custom || []).map((c) => ({ id: c.id, name: c.name, description: c.description, code: c.code }));
    const r = await api.exportKeys(set);
    if (r.ok) toast('Saved ' + r.file.split(/[\\/]/).pop());
    else if (!r.canceled) toast('Not saved: ' + (r.error || 'unknown error'));
  }
  async function importKeys() {
    const r = await api.importKeys();
    if (!r.ok) {
      if (!r.canceled) toast(r.error);
      return;
    }
    const res = KS.importSet(menuDraft, r.set);
    if (!res.ok) return toast(res.error);
    if (res.shortcuts) {
      for (const [k] of SHORTCUTS) if (typeof res.shortcuts[k] === 'string') scDraft[k] = res.shortcuts[k];
      markDirty('shortcuts');
    }
    let libN = 0;
    if (res.library) {
      // Only known functions and known settings; everything as text.
      for (const f of D.library.functions) {
        const theirs = res.library[f.id];
        if (!theirs || typeof theirs !== 'object') continue;
        for (const k of Object.keys(libDraft.values[f.id])) if (typeof theirs[k] === 'string') libDraft.values[f.id][k] = theirs[k];
        libN++;
      }
      if (libN) markDirty('library');
    }
    const fnN = addImportedFunctions(r.set, res.library);
    markDirty('menu');
    render();
    toast(`Imported ${res.matched} key${res.matched === 1 ? '' : 's'}` + (libN ? ` and ${libN} functions` : '') + (fnN ? `, plus ${fnN} of their own functions (look them over in Functions before saving)` : '') + (res.unmatched.length ? `; ${res.unmatched.length} not in your rings` : '') + '. Save to keep them.');
  }

  // Someone's own functions from a file: added (same id = replaced), never
  // run on import. Returns how many.
  function addImportedFunctions(set, library) {
    let n = 0;
    for (const f of Array.isArray(set.functions) ? set.functions : []) {
      if (!f || typeof f.id !== 'string' || !/^my[a-z0-9]{3,24}$/.test(f.id) || typeof f.code !== 'string') continue;
      const c = { id: f.id, name: String(f.name || 'My function'), description: String(f.description || ''), code: f.code };
      libDraft.custom = (libDraft.custom || []).filter((x) => x.id !== c.id).concat([c]);
      const theirs = library && library[c.id];
      libDraft.values[c.id] = { On: theirs && theirs.On === '1' ? '1' : '0', Hotkey: theirs && typeof theirs.Hotkey === 'string' ? theirs.Hotkey : '' };
      n++;
    }
    if (n) markDirty('library');
    return n;
  }
  // Functions page: only My functions go in and out (ring keys and
  // shortcuts are Shortcuts > Export / Import). Same file format, so a
  // Shortcuts export imports here too.
  async function exportFunctions() {
    const mine = libDraft.custom || [];
    if (!mine.length) return toast('No functions of your own yet. "New function" starts one.');
    const set = KS.exportSet({ categories: [] }, null, null);
    set.note = 'RadGesture functions. Import it in RadGesture: Settings > Functions > Import functions.';
    set.library = {};
    for (const c of mine) set.library[c.id] = { On: (libDraft.values[c.id] || {}).On || '0', Hotkey: (libDraft.values[c.id] || {}).Hotkey || '' };
    set.functions = mine.map((c) => ({ id: c.id, name: c.name, description: c.description, code: c.code }));
    const r = await api.exportKeys(set, 'functions');
    if (r.ok) toast(`Saved ${mine.length} function${mine.length === 1 ? '' : 's'} to ` + r.file.split(/[\\/]/).pop());
    else if (!r.canceled) toast('Not saved: ' + (r.error || 'unknown error'));
  }
  async function importFunctions() {
    const r = await api.importKeys('functions');
    if (!r.ok) {
      if (!r.canceled) toast(r.error);
      return;
    }
    const lib = r.set && r.set.library && typeof r.set.library === 'object' && !Array.isArray(r.set.library) ? r.set.library : null;
    const n = r.set && r.set.format === KS.FORMAT ? addImportedFunctions(r.set, lib) : 0;
    if (!n) return toast('No functions in that file.' + (r.set && Array.isArray(r.set.keys) && r.set.keys.length ? ' It holds ring keys: import it in Shortcuts.' : ''));
    ui.fx = Object.assign(FF.fresh(), { sort: ui.fx.sort, view: ui.fx.view });
    render();
    const el = document.getElementById('myFunctions');
    if (el) el.scrollIntoView({ block: 'start' });
    toast(`Added ${n} function${n === 1 ? '' : 's'} to My functions. Look them over, then Save.`);
  }

  function ownShortcutsCard() {
    const known = knownHotkeys();
    const card = h('div', { class: 'card' }, h('h2', {}, 'RadGesture\'s shortcuts'),
      h('p', { class: 'hint', style: 'margin:-6px 0 6px' }, 'These work anywhere. Each needs Ctrl, Alt, Shift or Win (or an F-key) so it never fires while you type.'));
    SHORTCUTS.forEach(([k, label, sub]) => {
      const clash = HK.clashes(scDraft[k], known.filter((x) => x.field !== k));
      card.append(row(label, sub,
        recorder(scDraft[k], (v) => { scDraft[k] = v || (k === 'trigger' ? '^CapsLock' : ''); markDirty('shortcuts'); render(); }),
        scDraft[k] ? h('button', { class: 'btn ghost small', onclick: () => { scDraft[k] = k === 'trigger' ? '^CapsLock' : ''; markDirty('shortcuts'); render(); } }, k === 'trigger' ? 'Reset' : 'Clear') : null,
        clash.length ? h('div', { class: 'warnline', style: 'flex-basis:100%' }, msym('warning'), `Also used by ${clash.map((c) => `${c.script} (${c.does})`).join(', ')}.`) : null));
    });
    return card;
  }

  function ringKeysCard() {
    const all = KS.keyItems(menuDraft);
    const dups = new Map();
    for (const group of KS.duplicates(menuDraft)) for (const k of group) dups.set(k.item, group.filter((x) => x !== k));
    const ours = SHORTCUTS.filter(([k]) => scDraft[k]).map(([k, label]) => ({ key: scDraft[k], does: label }));
    const external = knownHotkeys().filter((x) => x.script !== 'RadGesture');
    const q = ui.keyQuery.trim().toLowerCase();
    const shown = all.filter((k) => !q || k.path.join(' ').toLowerCase().includes(q) || HK.pretty(k.keys).toLowerCase().includes(q));
    const unset = all.filter((k) => !k.keys).length;

    const card = h('div', { class: 'card' }, h('h2', {}, 'Keys the ring presses'));
    const search = h('input', { type: 'text', id: 'keySearch', class: 'search', placeholder: 'Search by name or key', value: ui.keyQuery,
      oninput: (e) => { ui.keyQuery = e.target.value; const pos = e.target.selectionStart; render(); const s2 = document.getElementById('keySearch'); s2.focus(); s2.setSelectionRange(pos, pos); } });
    card.append(h('div', { class: 'ktools' },
      h('div', { class: 'searchbox' }, msym('search'), search),
      h('span', { class: 'chip' }, `${all.length} keys`),
      dups.size ? h('span', { class: 'chip warn' }, msym('warning'), `${dups.size} share a key`) : null,
      unset ? h('span', { class: 'chip' }, `${unset} not set`) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost small', id: 'resetKeys', title: 'The keys RadGesture comes with', onclick: () => { const n = KS.resetToDefaults(menuDraft, D.defaultMenu); markDirty('menu'); render(); toast(`${n} keys back to the defaults. Save to keep them.`); } }, msym('restart_alt'), 'Defaults'),
      ui.confirmClear
        ? h('span', { class: 'confirm' }, 'Clear every key?',
          h('button', { class: 'btn small danger', id: 'clearKeysYes', onclick: () => { KS.clearAll(menuDraft); ui.confirmClear = false; markDirty('menu'); render(); toast('All cleared. Record your own, then Save.'); } }, 'Clear all'),
          h('button', { class: 'btn ghost small', onclick: () => { ui.confirmClear = false; render(); } }, 'Keep'))
        : h('button', { class: 'btn ghost small', id: 'clearKeys', title: 'Start from nothing', onclick: () => { ui.confirmClear = true; render(); } }, msym('backspace'), 'Clear all')));

    if (!all.length) {
      card.append(h('div', { class: 'empty' }, 'No direction presses keys yet. In Rings, set a direction\'s action to "Press keys".'));
      return card;
    }
    if (!shown.length) {
      card.append(h('div', { class: 'empty' }, 'Nothing matches.'));
      return card;
    }
    let lastGroup = null;
    const list = h('div', { class: 'klist' });
    for (const k of shown) {
      const group = k.path.slice(0, -1).join(' › ');
      if (group !== lastGroup) {
        const cat = menuDraft.categories[k.ring];
        list.append(h('div', { class: 'kgroup' }, h('span', { class: 'swatch', style: `background:${T.ringColor(menuDraft, k.ring)}` }), group));
        lastGroup = group;
      }
      const notes = [];
      const d = dups.get(k.item);
      if (d) notes.push(h('span', { class: 'chip warn' }, msym('warning'), 'Same as ' + d.map((x) => x.path[x.path.length - 1]).join(', ')));
      const own = k.keys && ours.find((o) => HK.same(o.key, k.keys));
      if (own) notes.push(h('span', { class: 'chip warn' }, msym('warning'), `RadGesture's ${own.does} shortcut`));
      const ext = k.keys && external.filter((x) => HK.same(x.key, k.keys));
      if (ext && ext.length) notes.push(h('span', { class: 'note', title: ext.map((x) => `${x.script}: ${x.does}`).join('\n') }, msym('link'), `${ext[0].script}: ${ext[0].does}`));
      list.append(h('div', { class: 'krow' + (k.keys ? '' : ' unset') },
        h('span', { class: 'kic' }, icon(k.item.icon || 'keyboard')),
        h('span', { class: 'kname' }, k.path[k.path.length - 1]),
        recorder(k.keys, (v) => { KS.setKeys(k.item, v); markDirty('menu'); render(); }, { plain: true }),
        h('span', { class: 'knotes' }, ...notes),
        k.keys ? h('button', { class: 'iconbtn', title: 'Clear this key', 'aria-label': 'Clear ' + k.path[k.path.length - 1], onclick: () => { KS.setKeys(k.item, ''); markDirty('menu'); render(); } }, msym('close')) : h('span', { style: 'width:28px' })));
    }
    card.append(list);
    return card;
  }

  // ---------------------------------------------------------------- Functions (the function collection)
  //
  // The built-in functions (run by the helper), one entry per function
  // with its description, its keyboard shortcut (on/off + the key), the key it
  // presses inside Sectra or PowerScribe, Try it, where it sits on the rings,
  // and its code. Defaults in config/library.json; choices in RadGesture.ini.

  // "Presses Alt+O in Sectra" - the note that the key must already do that
  // job in this person's Sectra / PowerScribe (everyone's keys differ).
  function libKeyNote(f, inEditor) {
    const v = libDraft.values[f.id] || {};
    const keys = (f.params || []).filter((p) => p.type === 'key' && v[p.name]);
    if (!keys.length) return null;
    const what = keys.map((p) => `${HK.pretty(sendToHotkey(v[p.name]))} ${p.label.replace(/^Presses /, '').replace(/\s*\(.*\)$/, '')}`).join(' and ');
    return h('div', { class: 'warnline libnote' }, msym('info'),
      h('span', {}, `Presses ${what}. That key must already do this in your ${f.group === 'PowerScribe' ? 'PowerScribe' : 'Sectra'}` +
        (inEditor ? ': change it in Functions if yours is different.' : ': set it there first, or record the key yours uses.')));
  }

  // Where each library function sits on the rings.
  function libPlaces() {
    const out = {};
    menuDraft.categories.forEach((cat) => {
      const walk = (items, path) => (items || []).forEach((it) => {
        if (it.items) walk(it.items, path.concat(it.name));
        else if (typeof it.action === 'string' && it.action.startsWith('helper:lib:')) {
          const id = it.action.slice('helper:lib:'.length);
          (out[id] = out[id] || []).push(path.concat(it.name).join(' › '));
        }
      });
      walk(cat.items, [cat.name]);
    });
    return out;
  }

  function setLib(id, k, v) {
    libDraft.values[id][k] = v;
    markDirty('library');
    render();
  }

  function renderLibrary() {
    $main.append(h('h1', {}, 'Functions'),
      h('p', { class: 'lede' }, 'Ready-made functions for Sectra, PowerScribe and your apps, plus your own. Run them from the ring or their keyboard shortcut.'),
      h('div', { class: 'fnactions' },
        h('button', { class: 'btn small primary', id: 'newFunctionTop', onclick: () => addCustom() }, msym('add'), 'New function'),
        h('button', { class: 'btn small', id: 'importFunctions', onclick: importFunctions }, msym('download'), 'Import functions...'),
        h('button', { class: 'btn small', id: 'exportFunctions', onclick: exportFunctions }, msym('upload'), 'Export my functions...')));
    const optimizer = (D.status.conflicts || []).filter((c) => c.optimizer);
    const strip = h('div', { class: 'fnstrip' }, libHealth());
    $main.append(strip);
    if (optimizer.length) $main.append(h('div', { class: 'card libhealth warn slim', id: 'optimizerNote' },
      h('div', { class: 'big' }, msym('warning'), h('p', {}, 'Rad Optimizer is running and fights RadGesture for these keys.'),
        h('button', { class: 'btn small primary', id: 'closeOptimizer', onclick: async () => { D.status = await api.closeConflicts(); toast('Closed'); render(); } }, msym('close'), 'Close it now'))));
    // "Read first": folded by default so the list starts near the top.
    const open = !!ui.readFirst;
    const setup = h('div', { class: 'card setup readfirst' + (open ? ' open' : ''), id: 'libSetup' },
      h('button', { class: 'rfhead', id: 'readFirst', 'aria-expanded': String(open), onclick: () => { ui.readFirst = !open; render(); } },
        msym('priority_high'), h('span', { class: 'rftitle' }, 'Read first: set the keys in Sectra'),
        h('span', { class: 'rfhint' }, open ? 'Hide' : '3 short steps'), msym(open ? 'expand_less' : 'expand_more')));
    if (open) setup.append(h('div', { class: 'steps3' },
        h('div', { class: 'step' }, h('div', { class: 'stepn' }, '1'), h('div', { class: 'stepb' }, h('b', {}, msym('settings_applications'), 'Keys in Sectra and PowerScribe'),
          h('p', {}, 'Most functions bring Sectra or PowerScribe up and press a key there ("Presses in Sectra"). That key must already do the job in your Sectra: set it in Sectra\'s keyboard settings, or record the key yours uses.'),
          h('div', { class: 'addrow' }, h('button', { class: 'btn small', id: 'copyLibKeys', onclick: copyLibKeys }, msym('content_copy'), 'Copy the list')))),
        h('div', { class: 'step' }, h('div', { class: 'stepn' }, '2'), h('div', { class: 'stepb' }, h('b', {}, msym('keyboard'), 'Your shortcuts'),
          h('p', {}, 'Every shortcut starts switched on. Switch off the ones you don\'t want, or record your own. A mouse button or macro pad set to send the same shortcut (e.g. Ctrl+Alt+P for Insert priors) works too.'))),
        h('div', { class: 'step' }, h('div', { class: 'stepn' }, '3'), h('div', { class: 'stepb' }, h('b', {}, msym('block'), 'One program per key'),
          h('p', {}, 'Another shortcut script that listens for the same keys would fight RadGesture for them. Status lists any it finds; close them and take them out of Windows startup.')))));
    strip.append(setup);

    const known = knownHotkeys();
    const places = libPlaces();
    const fx = ui.fx;
    // Every function as a searchable card (built-in and mine), with its clash.
    const fns = allFns();
    const cards = fns.map((f) => {
      const v = libDraft.values[f.id] || {};
      const clash = v.On === '1' && v.Hotkey ? HK.clashes(v.Hotkey, known.filter((k) => k.lib !== f.id)).length > 0 : false;
      const code = f.custom ? ((libDraft.custom || []).find((c) => c.id === f.id) || {}).code : '';
      return FF.card(f, v, places[f.id] || [], clash, code);
    });
    const byId = new Map(fns.map((f) => [f.id, f]));
    const shown = FF.apply(cards, fx);
    $main.append(filterBar(cards, shown));

    const groups = D.library.groups.concat(['My functions']);
    if (fx.sort === 'group') {
      for (const g of groups) {
        const inG = shown.filter((c) => c.group === g);
        if (g === 'My functions') {
          if (inG.length || !FF.activeCount(fx)) $main.append(myFunctionsCard(inG, byId, known, places));
          continue;
        }
        if (!inG.length) continue;
        const card = h('div', { class: 'card' }, h('h2', {}, g, h('span', { class: 'count' }, String(inG.length))));
        if (g === 'Logins') card.append(workflowPointer());
        if (fx.view === 'tiles') {
          // Tiles in smaller groups by what they do (Window / level, Measure...).
          const subs = [...new Set(inG.map((c) => c.sub))];
          for (const s of subs) {
            const inS = inG.filter((c) => c.sub === s);
            if (subs.length > 1 && s) card.append(h('h3', { class: 'fnsubhead' }, s, h('span', { class: 'count' }, String(inS.length))));
            card.append(fnTiles(inS, byId, known, places));
          }
        } else for (const c of inG) card.append(fnEntry(byId.get(c.id), c, known, places));
        $main.append(card);
      }
    } else {
      const card = h('div', { class: 'card', id: 'fnResults' }, h('h2', {}, fx.sort === 'az' ? 'A to Z' : 'By shortcut', h('span', { class: 'count' }, String(shown.length))));
      if (shown.some((c) => c.group === 'Logins')) card.append(workflowPointer());
      if (fx.view === 'tiles') card.append(fnTiles(shown, byId, known, places));
      else for (const c of shown) card.append(fnEntry(byId.get(c.id), c, known, places));
      if (shown.length) $main.append(card);
    }
    if (!shown.length) $main.append(h('div', { class: 'empty', id: 'fnNone' }, 'No function matches these filters. ',
      h('button', { class: 'linkbtn', onclick: () => { ui.fx = FF.fresh(); render(); } }, 'Clear filters')));
  }

  // Are the function shortcuts really listening? The helper reports how many
  // it switched on after every start and save ("are my shortcuts working?"
  // answered at a glance).
  function libHealth() {
    const s = D.status;
    const lh = s.libHotkeys;
    let kind, text;
    if (!s.helper.connected) { kind = 'bad'; text = 'The helper is not running, so no function shortcut works right now. See Status.'; }
    else if (!lh) { kind = 'warn'; text = 'The helper has not reported its shortcuts. If this stays, it is an older RadGesture: install the latest one.'; }
    else if (lh.failed.length) { kind = 'bad'; text = `${lh.count} function shortcuts work; these could not be set: ${lh.failed.join(', ')}.`; }
    else if (lh.count < s.libHotkeysWanted) { kind = 'warn'; text = `${lh.count} of ${s.libHotkeysWanted} function shortcuts work. Save once to reload them.`; }
    else { kind = 'good'; text = `All ${lh.count} function shortcuts are switched on and listening.`; }
    return h('div', { class: 'card libhealth slim ' + kind, id: 'libHealth' },
      h('div', { class: 'big' }, h('span', { class: 'orb ' + (kind === 'good' ? 'good' : 'bad') }, msym(kind === 'good' ? 'check_circle' : kind === 'warn' ? 'help' : 'error')),
        h('p', {}, text)));
  }

  function workflowPointer() {
    return h('div', { class: 'hint', style: 'margin:-4px 0 8px' }, 'Your username, apps and websites are on the ',
      h('button', { class: 'linkbtn', onclick: () => setTab('workflow') }, 'Workflow page'), '.');
  }

  // ---- Workflow: what you open or type many times a day, in one place.
  // Logins (username + their shortcuts), apps (Epic, Teams and the programs
  // on your rings), websites. The functions are the same ones as on the
  // Functions page; this page only gathers them.
  function renderWorkflow() {
    $main.append(h('h1', {}, 'Workflow'),
      h('p', { class: 'lede' }, 'Your logins, apps and websites: what you open or type many times a day.'));
    const known = knownHotkeys();
    const places = libPlaces();
    const entry = (id) => { const f = libFn(id); return f ? libEntry(f, known, places[id] || []) : null; };

    $main.append(h('div', { class: 'card', id: 'wfLogin' },
      h('h2', {}, msym('badge'), 'Log in'),
      h('p', { class: 'hint', style: 'margin:-6px 0 10px' }, 'Shift+Alt+U types your username, Tab, your password and Enter, wherever the cursor is. The password is asked once per session, kept in memory only, and never saved.'),
      usernameRow(),
      ...['LoginUandP', 'LoginU', 'LoginP', 'LoginForget'].map(entry)));

    // Programs the rings open ("Open a program" directions), wherever they are.
    const progs = [];
    menuDraft.categories.forEach((c, ci) => {
      const walk = (items, path, names) => (items || []).forEach((it, i) => {
        if (Array.isArray(it.items)) walk(it.items, path.concat(i), names.concat(it.name));
        else if (/^app:/.test(it.action || '')) progs.push({ it, ci, path, i, where: names.join(' > ') });
      });
      walk(c.items, [], [c.name]);
    });
    const progCard = h('div', { class: 'card', id: 'wfApps' },
      h('h2', {}, msym('apps'), 'Apps'),
      entry('ActivateEPIC'), entry('ActivateTeams'),
      h('h3', { class: 'subhead' }, 'Programs on your rings'));
    if (!progs.length) progCard.append(h('p', { class: 'hint' }, 'None yet. Add one in Rings: pick a direction, choose "Open a program".'));
    for (const p of progs) {
      progCard.append(row(p.it.name, `${p.where}  ·  ${String(p.it.action).slice(4)}`,
        h('span', { class: 'hint' }, 'Start with RadGesture'),
        sw(!!p.it.startWithHub, (v) => { p.it.startWithHub = v || undefined; markDirty('menu'); render(); }, 'Start ' + p.it.name + ' with RadGesture'),
        h('button', { class: 'btn ghost small', onclick: () => { ui.ring = p.ci; ui.path = p.path; ui.sel = p.i; setTab('rings'); } }, msym('edit'), 'Edit')));
    }
    progCard.append(h('div', { class: 'addrow' }, h('button', { class: 'btn small', onclick: () => setTab('rings') }, msym('add'), 'Add a program in Rings')));
    $main.append(progCard);

    $main.append(h('div', { class: 'card', id: 'wfWeb' },
      h('h2', {}, msym('public'), 'Websites'),
      entry('OpenChromeTabs'), entry('SearchRadiopaediaGoogle')));
  }

  function usernameRow() {
    return row('Your username', 'Typed by the login functions. Stays on this PC; never in exported shortcut files. The password is asked once per session and never saved.',
      h('input', { type: 'text', id: 'libUser', value: libDraft.username || '', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. A123456',
        oninput: (e) => { libDraft.username = e.target.value; markDirty('library'); } }));
  }

  // The full entry of one function (its shortcut, the keys it presses, Try it, Code...).
  function fullEntry(f, known, places) {
    return f.custom ? customEntry((libDraft.custom || []).find((x) => x.id === f.id), known, places[f.id] || []) : libEntry(f, known, places[f.id] || []);
  }

  // Tiles view: a small tile per function (icon, name, its shortcut, what it
  // presses where). A click opens its full entry right under its row; the
  // panel spans the grid and "dense" packing lets the rest of the row fill
  // in before it. One open at a time.
  function fnTiles(list, byId, known, places) {
    const grid = h('div', { class: 'fntiles' });
    for (const c of list) {
      const f = byId.get(c.id);
      const open = ui.tileOpen === c.id;
      grid.append(fnTile(f, c, open));
      if (!open) continue;
      const el = fullEntry(f, known, places);
      const btns = el.querySelector('.libbtns');
      if (btns) btns.append(h('button', { class: 'iconbtn', title: 'Close', 'aria-label': 'Close ' + f.name, onclick: () => { ui.tileOpen = null; render(); } }, msym('close')));
      grid.append(h('div', { class: 'fndetail' }, el));
    }
    return grid;
  }

  function fnTile(f, c, open) {
    const k = (spec) => h('span', { class: 'keys' }, HK.pretty(spec).split('+').map((x) => h('kbd', {}, x)));
    const kp = (f.params || []).find((p) => p.type === 'key');
    const where = kp ? kp.label.replace(/^Presses\s*/i, '').replace(/\s*\(.*$/, '') : '';
    return h('button', { class: 'fntile' + (open ? ' open' : ''), id: 'tile-' + f.id, 'data-group': f.group, 'aria-expanded': String(open), title: f.description || '',
      onclick: () => {
        ui.tileOpen = open ? null : f.id;
        render();
        const el = document.getElementById('lib-' + f.id);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } },
    c.places.length ? h('span', { class: 'fnring', title: 'On the ring: ' + c.places.join('; ') }, msym('donut_large')) : null,
    h('span', { class: 'fntop' }, h('span', { class: 'fnic' }, icon(f.icon || 'code')), h('span', { class: 'fnname' }, f.name)),
    h('span', { class: 'fnfoot' },
      h('span', { class: 'fnline', title: 'Keyboard shortcut' }, msym('keyboard'),
        c.on && c.hotkey ? k(c.hotkey) : h('span', {}, c.hotkey ? 'Shortcut off' : 'No shortcut'),
        c.clash ? h('span', { class: 'fnclash', title: 'This shortcut is also used elsewhere' }, msym('warning')) : null),
      c.keys.length ? h('span', { class: 'fnline', title: 'What it presses' }, msym('east'), k(c.keys[0]), where ? h('span', {}, where) : null) : null));
  }

  // One function: the full entry, or (compact view) one line that opens it.
  function fnEntry(f, c, known, places) {
    const full = () => fullEntry(f, known, places);
    if (ui.fx.view !== 'compact' || ui.libOpen[f.id]) {
      const el = full();
      if (ui.fx.view === 'compact') {
        const fold = h('button', { class: 'btn ghost small fold', title: 'Back to one line', 'aria-label': 'Fold ' + f.name, onclick: () => { delete ui.libOpen[f.id]; render(); } }, msym('unfold_less'));
        const btns = el.querySelector('.libbtns');
        if (btns) btns.prepend(fold);
      }
      return el;
    }
    const k = (spec) => h('span', { class: 'keys' }, HK.pretty(spec).split('+').map((x) => h('kbd', {}, x)));
    return h('div', { class: 'fnrow', id: 'lib-' + f.id, role: 'button', tabindex: '0', title: f.description,
      onclick: () => { ui.libOpen[f.id] = true; render(); },
      onkeydown: (e) => { if (e.key === 'Enter') { ui.libOpen[f.id] = true; render(); } } },
    h('span', { class: 'kic' }, icon(f.icon)),
    h('span', { class: 'fnname' }, f.name),
    h('span', { class: 'fnsub' }, f.sub),
    h('span', { class: 'fnkey', title: 'Keyboard shortcut' }, c.on && c.hotkey ? k(c.hotkey) : h('span', { class: 'ph' }, c.hotkey ? 'off' : '-')),
    h('span', { class: 'fnpress', title: 'Presses in the program' }, c.keys.length ? [msym('east'), ...c.keys.map((x) => k(x))] : null),
    h('span', { class: 'fnflags' },
      c.places.length ? h('span', { class: 'chip', title: 'On the ring: ' + c.places.join('; ') }, msym('donut_large'), String(c.places.length)) : null,
      c.clash ? h('span', { class: 'chip warn', title: 'Its shortcut is also used elsewhere' }, msym('warning')) : null),
    h('button', { class: 'iconbtn', title: 'Try it (saved settings)', 'aria-label': 'Try ' + f.name,
      onclick: (e) => { e.stopPropagation(); api.runHelperAction('lib:' + f.id); toast('Sent to the helper: ' + f.name); } }, msym('play_arrow')));
  }

  // Search, filters, sorting and the view: everything in ui.fx (fnfilter.js).
  function filterBar(cards, shown) {
    const fx = ui.fx;
    const set = (k, v) => { fx[k] = v; render(); };
    const n = FF.activeCount(fx);
    const search = h('input', { type: 'text', id: 'libSearch', class: 'search', value: fx.q,
      placeholder: 'Search: name, what it does, a ring, or a key like Ctrl+Alt+P',
      oninput: (e) => { fx.q = e.target.value; const pos = e.target.selectionStart; render(); const s2 = document.getElementById('libSearch'); s2.focus(); s2.setSelectionRange(pos, pos); } });
    const count = (pred) => cards.filter(pred).length;
    const groups = D.library.groups.concat(['My functions']);
    const groupChips = h('div', { class: 'fxchips', role: 'group', 'aria-label': 'Groups' }, groups.map((g) => {
      const on = fx.groups.includes(g);
      return h('button', { class: 'fxchip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-group': g,
        onclick: () => { fx.groups = on ? fx.groups.filter((x) => x !== g) : fx.groups.concat([g]); fx.sub = ''; render(); } },
      g, h('i', {}, String(count((c) => c.group === g))));
    }));
    const subs = [...new Set(cards.filter((c) => !fx.groups.length || fx.groups.includes(c.group)).map((c) => c.sub).filter(Boolean))].sort();
    const subSel = h('select', { id: 'fxSub', onchange: (e) => set('sub', e.target.value) },
      h('option', { value: '' }, 'Every kind'), subs.map((x) => h('option', { value: x, selected: x === fx.sub }, x)));
    const keyFind = h('span', { class: 'fxkey' }, recorder(fx.key, (k) => set('key', k), { plain: true }),
      fx.key ? h('button', { class: 'iconbtn', title: 'Stop finding by key', 'aria-label': 'Clear key', onclick: () => set('key', '') }, msym('close')) : null);
    // The finer filters fold away so the functions start near the top;
    // they stay open while one of them is in use.
    const moreN = (fx.sub ? 1 : 0) + ['shortcut', 'ring', 'program'].filter((k) => fx[k] !== 'any').length + (fx.clash ? 1 : 0) + (fx.sort !== 'group' ? 1 : 0);
    const more = !!ui.fxMore || moreN > 0;
    return h('div', { class: 'card fxbar', id: 'fnFilters' },
      h('div', { class: 'fxrow' },
        h('div', { class: 'searchbox grow' }, msym('search'), search),
        h('span', { class: 'fxlabel' }, 'Find by key'), keyFind,
        h('button', { class: 'btn small' + (more ? ' on' : ''), id: 'fxMore', 'aria-expanded': String(more), onclick: () => { ui.fxMore = !more; render(); } },
          msym('tune'), 'Filters', moreN ? h('i', { class: 'fxn' }, String(moreN)) : null),
        seg([['tiles', 'Tiles', 'grid_view'], ['detail', 'Detailed', 'view_agenda'], ['compact', 'Compact', 'view_list']], fx.view, (v) => { ui.libOpen = {}; ui.tileOpen = null; set('view', v); })),
      h('div', { class: 'fxrow' }, groupChips, h('span', { class: 'grow' }),
        h('span', { class: 'chip', id: 'fxCount' }, `${shown.length} of ${cards.length}`),
        n ? h('button', { class: 'btn ghost small', id: 'fxClear', onclick: () => { const keep = { sort: fx.sort, view: fx.view }; ui.fx = Object.assign(FF.fresh(), keep); render(); } }, msym('filter_alt_off'), `Clear filters (${n})`) : null),
      more ? h('div', { class: 'fxmore' },
      h('div', { class: 'fxrow' },
        h('label', { class: 'fxlabel' }, 'Kind'), subSel,
        h('label', { class: 'fxlabel' }, 'Works in'), seg([['any', 'Any'], ['sectra', 'Sectra'], ['powerscribe', 'PowerScribe'], ['other', 'Other']], fx.program, (v) => set('program', v))),
      h('div', { class: 'fxrow' },
        h('label', { class: 'fxlabel' }, 'Shortcut'), seg([['any', 'Any'], ['on', 'On'], ['off', 'Off'], ['none', 'None']], fx.shortcut, (v) => set('shortcut', v)),
        h('label', { class: 'fxlabel' }, 'Ring'), seg([['any', 'Any'], ['on', 'On a ring'], ['off', 'Not on one']], fx.ring, (v) => set('ring', v)),
        h('button', { class: 'fxchip' + (fx.clash ? ' on' : ''), id: 'fxClash', 'aria-pressed': String(fx.clash), onclick: () => set('clash', !fx.clash) }, msym('warning'), 'Clashes', h('i', {}, String(count((c) => c.clash))))),
      h('div', { class: 'fxrow' },
        h('label', { class: 'fxlabel' }, 'Sort'), seg([['group', 'By group'], ['az', 'A to Z'], ['shortcut', 'By shortcut']], fx.sort, (v) => set('sort', v)),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost small', id: 'libDefaults', title: 'Shortcuts and keys as RadGesture ships them (your username, websites and own functions stay)', onclick: () => {
          for (const f of D.library.functions) {
            const v = libDraft.values[f.id];
            v.On = f.on ? '1' : '0';
            v.Hotkey = f.hotkey || '';
            for (const p of f.params || []) if (p.type === 'key' || p.type === 'bool') v[p.name] = p.default;
          }
          markDirty('library');
          render();
          toast('Back to the defaults. Save to keep them.');
        } }, msym('restart_alt'), 'Defaults'))) : null);
  }

  // ---- My functions: scripts a person (or a colleague) writes. Saved as AutoHotkey files in the
  // RadGesture folder; each runs as its own little program.
  const NEW_FN_CODE = [
    '; Your AutoHotkey (v1.1) code. It runs when you pick this function on the',
    '; ring or press its keyboard shortcut. Example: bring up Sectra, press Alt+O.',
    'WinActivate, Image Window',
    'WinWaitActive, Image Window, , 1',
    'Send, !o',
  ].join('\n');
  function newCustomId() {
    return 'my' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  function addCustom(from) {
    const id = newCustomId();
    const f = from || { name: 'My function', description: '', code: NEW_FN_CODE };
    libDraft.custom = (libDraft.custom || []).concat([{ id, name: f.name, description: f.description, code: f.code }]);
    libDraft.values[id] = { On: '0', Hotkey: '' };
    ui.fx = Object.assign(FF.fresh(), { sort: ui.fx.sort, view: ui.fx.view });
    ui.libOpen[id] = true;
    ui.tileOpen = id;
    markDirty('library');
    render();
    const el = document.getElementById('lib-' + id);
    if (el) el.scrollIntoView({ block: 'center' });
  }
  // A built-in "bring it up and press a key" function as a starting point.
  function copyAsCustom(f) {
    const v = libDraft.values[f.id] || {};
    const win = f.target === 'powerscribe' ? 'ahk_exe Nuance.PowerScribe360.exe' : 'Image Window';
    addCustom({ name: f.name + ' (my copy)', description: f.description, code: `; Copied from the function "${f.name}".\nWinActivate, ${win}\nWinWaitActive, ${win}, , 1\nSend, ${v.Key || ''}` });
  }

  function myFunctionsCard(inCards, byId, known, places) {
    const card = h('div', { class: 'card', id: 'myFunctions' }, h('h2', {}, 'My functions', h('span', { class: 'count' }, String(inCards.length))),
      h('p', { class: 'hint', style: 'margin:-6px 0 10px' },
        'Add your own: give it a name, write its AutoHotkey code, then put it on a ring (Rings: Function) or give it a keyboard shortcut. ',
        'Each one runs as its own small program, so a mistake shows AutoHotkey\'s error box and never stops RadGesture. ',
        'Share them with Export my functions at the top of this page; import only from people you trust, since a function can do anything a program can.'),
      h('div', { class: 'addrow' }, h('button', { class: 'btn primary small', id: 'addMyFunction', onclick: () => addCustom() }, msym('add'), 'New function')));
    if (ui.fx.view === 'tiles' && inCards.length) card.append(fnTiles(inCards, byId, known, places));
    else for (const c of inCards) card.append(fnEntry(byId.get(c.id), c, known, places));
    if (!(libDraft.custom || []).length) card.append(h('div', { class: 'hint', style: 'margin-top:10px' }, 'None yet. Tip: "Copy" on any PACS or PowerScribe function above starts one from it.'));
    return card;
  }

  function customEntry(c, known, places) {
    const v = libDraft.values[c.id] || (libDraft.values[c.id] = { On: '0', Hotkey: '' });
    const isOn = v.On === '1';
    const clash = isOn && v.Hotkey ? HK.clashes(v.Hotkey, known.filter((k) => k.lib !== c.id)) : [];
    const touch = () => markDirty('library');
    return h('div', { class: 'libfn', id: 'lib-' + c.id },
      h('div', { class: 'libhead' },
        h('span', { class: 'kic' }, msym('code')),
        h('div', { class: 'libtx' },
          h('input', { type: 'text', class: 'myname', value: c.name, placeholder: 'Name', oninput: (e) => { c.name = e.target.value; touch(); } }),
          h('input', { type: 'text', class: 'mydesc', value: c.description, placeholder: 'What it does (for you and colleagues)', oninput: (e) => { c.description = e.target.value; touch(); } }),
          h('small', { class: 'libplaces' }, msym('donut_large'), places.length ? 'On the ring: ' + places.join('; ') : 'Not on a ring (add it in Rings: Function)')),
        h('div', { class: 'libbtns' },
          h('button', { class: 'btn small', title: 'Runs it now with your SAVED settings', onclick: () => { api.runHelperAction('lib:' + c.id); toast('Sent to the helper: ' + c.name); } }, msym('play_arrow'), 'Try it'),
          h('button', { class: 'btn ghost small danger', title: 'Delete this function', onclick: () => {
            libDraft.custom = libDraft.custom.filter((x) => x !== c);
            delete libDraft.values[c.id];
            markDirty('library');
            render();
          } }, msym('delete')))),
      h('div', { class: 'libctl' },
        h('div', { class: 'libline' },
          h('span', { class: 'liblabel' }, 'Keyboard shortcut'),
          sw(isOn, (x) => setLib(c.id, 'On', x ? '1' : '0'), 'Keyboard shortcut for ' + c.name),
          isOn ? recorder(v.Hotkey, (k) => setLib(c.id, 'Hotkey', k)) : h('span', { class: 'hint' }, 'off')),
        clash.length ? h('div', { class: 'warnline' }, msym('warning'), `Also used by ${clash.map((x) => `${x.script} (${x.does})`).join(', ')}.`) : null,
        h('textarea', { class: 'mycode', rows: Math.min(18, Math.max(6, c.code.split('\n').length + 1)), spellcheck: 'false', 'aria-label': 'AutoHotkey code for ' + c.name,
          oninput: (e) => { c.code = e.target.value; touch(); } }, c.code),
        h('div', { class: 'hint' }, 'AutoHotkey v1.1. Runs top to bottom. Sectra\'s window is "Image Window"; PowerScribe is "ahk_exe Nuance.PowerScribe360.exe".')));
  }


  function libEntry(f, known, places) {
    const v = libDraft.values[f.id];
    const isOn = v.On === '1';
    const clash = isOn && v.Hotkey ? HK.clashes(v.Hotkey, known.filter((k) => k.lib !== f.id)) : [];
    const ctl = h('div', { class: 'libctl' },
      h('div', { class: 'libline' },
        h('span', { class: 'liblabel' }, 'Keyboard shortcut'),
        sw(isOn, (x) => setLib(f.id, 'On', x ? '1' : '0'), 'Keyboard shortcut for ' + f.name),
        isOn ? recorder(v.Hotkey, (k) => setLib(f.id, 'Hotkey', k)) : h('span', { class: 'hint' }, v.Hotkey ? `off (${HK.pretty(v.Hotkey)})` : 'off')),
      clash.length ? h('div', { class: 'warnline' }, msym('warning'), `Also used by ${clash.map((c) => `${c.script} (${c.does})`).join(', ')}.`) : null);
    for (const p of f.params || []) {
      if (p.type === 'key') {
        ctl.append(h('div', { class: 'libline' }, h('span', { class: 'liblabel' }, p.label),
          recorder(sendToHotkey(v[p.name]), (k) => setLib(f.id, p.name, hotkeyToSend(k)), { plain: true })));
      } else if (p.type === 'bool') {
        ctl.append(h('div', { class: 'libline' }, h('span', { class: 'liblabel' }, p.label),
          sw(v[p.name] === '1', (x) => setLib(f.id, p.name, x ? '1' : '0'), p.label)));
      } else if (p.type === 'list') {
        ctl.append(h('div', { class: 'libline' }, h('span', { class: 'liblabel' }, p.label),
          h('textarea', { class: 'wide', rows: 4, id: 'lib-' + f.id + '-' + p.name, spellcheck: 'false',
            oninput: (e) => { v[p.name] = e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('|'); markDirty('library'); } },
          String(v[p.name] || '').split('|').join('\n'))));
      }
    }
    const note = libKeyNote(f, false);
    const showCode = !!ui.libCode[f.id];
    const code = (D.libraryCode || {})[f.id];
    return h('div', { class: 'libfn', id: 'lib-' + f.id },
      h('div', { class: 'libhead' },
        h('span', { class: 'kic' }, icon(f.icon)),
        h('div', { class: 'libtx' }, h('b', {}, f.name, h('span', { class: 'chip', style: 'margin-left:8px' }, f.sub)), h('small', {}, f.description),
          note,
          h('small', { class: 'libplaces' }, msym('donut_large'), places.length ? 'On the ring: ' + places.join('; ') : 'Not on a ring (add it in Rings: Function)')),
        h('div', { class: 'libbtns' },
          h('button', { class: 'btn small', title: 'Runs it now with your SAVED settings', onclick: () => { api.runHelperAction('lib:' + f.id); toast('Sent to the helper: ' + f.name); } }, msym('play_arrow'), 'Try it'),
          code ? h('button', { class: 'btn ghost small', onclick: () => { ui.libCode[f.id] = !showCode; render(); } }, msym('code'), showCode ? 'Hide code' : 'Code') : null,
          f.target ? h('button', { class: 'btn ghost small', title: 'Start one of My functions from this one', onclick: () => copyAsCustom(f) }, msym('content_copy'), 'Copy') : null)),
      ctl,
      showCode && code ? h('pre', { class: 'libcode' }, code) : null);
  }

  async function copyLibKeys() {
    const lines = ['RadGesture Functions: keys pressed inside Sectra / PowerScribe', ''];
    for (const g of D.library.groups) {
      const fns = D.library.functions.filter((f) => f.group === g && (f.params || []).some((p) => p.type === 'key'));
      if (!fns.length) continue;
      lines.push(g);
      for (const f of fns) {
        const v = libDraft.values[f.id];
        const keys = f.params.filter((p) => p.type === 'key').map((p) => `${p.label.replace(/^Presses /, '')}: ${v[p.name] ? HK.pretty(sendToHotkey(v[p.name])) : '(not set)'}`);
        lines.push(`  ${f.name}: ${keys.join('; ')}` + (v.On === '1' && v.Hotkey ? `   [shortcut ${HK.pretty(v.Hotkey)}]` : ''));
      }
      lines.push('');
    }
    await api.copyText(lines.join('\r\n'));
    toast('Copied. Paste it anywhere to keep it next to Sectra.');
  }

  // ---------------------------------------------------------------- Reference Library
  //
  // Notes (formatted text, Markdown underneath) and pictures (screenshots) kept
  // on this PC (src/main/references.js). Saved as you type. "Put on the ring"
  // adds it to the Reference Library ring's "My notes"; the ring opens it in
  // the reference viewer. The links on that ring are edited in Rings.

  let refsList = null; // loaded when the page (or the ring editor) needs it
  async function loadRefs() {
    refsList = await api.refs();
    return refsList;
  }
  const refById = (id) => (refsList || []).find((r) => r.id === id);

  function renderReferences() {
    $main.append(h('h1', {}, 'Reference Library'),
      h('p', { class: 'lede' }, 'Your guidelines, articles, notes and screenshots, in sections you make. Each section is a smaller ring on the Reference Library ring; anything in it opens in a clean window over whatever you are reading.'));
    if (!refsList) {
      $main.append(h('div', { class: 'empty' }, 'Loading...'));
      loadRefs().then(() => { if (ui.tab === 'references') render(); });
      return;
    }
    const ring = refRing();
    if (!ring) {
      $main.append(h('div', { class: 'card' }, h('p', {}, 'There is no Reference Library ring. Add a ring in Rings and name it "Reference Library".')));
      return;
    }
    const lib = RL.read(ring);
    const save = () => { RL.pack(ring, lib); markDirty('menu'); };
    const placedIds = new Set();
    lib.sections.forEach((s) => s.items.forEach((it) => (it.topic ? it.items : [it]).forEach((x) => { const id = refIdOf(x); if (id) placedIds.add(id); })));
    lib.loose.forEach((it) => { const id = refIdOf(it); if (id) placedIds.add(id); });
    const unplaced = refsList.filter((r) => !placedIds.has(r.id));

    // What is selected: a section, an entry in a section, or an entry in no section.
    const sel = parseSel(ui.refSel, lib, unplaced);
    if (!sel) ui.refSel = lib.sections.length ? 'sec:0' : null;
    const cur = parseSel(ui.refSel, lib, unplaced);
    // Where new things go: the topic or section being looked at, else the first section.
    const target = cur && cur.sec >= 0 ? (cur.topicIdx !== undefined ? `t:${cur.sec}:${cur.topicIdx}` : 's:' + cur.sec) : (lib.sections.length ? 's:0' : 'none');

    $main.append(refAddBar(lib, target, save));

    const q = (ui.refQuery || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hit = (text) => words.every((w) => String(text).toLowerCase().includes(w));
    const search = h('input', { type: 'text', id: 'refSearch', class: 'search', placeholder: 'Search sections, titles, tags, text and links', value: ui.refQuery || '',
      oninput: (e) => { ui.refQuery = e.target.value; const pos = e.target.selectionStart; render(); const s2 = document.getElementById('refSearch'); s2.focus(); s2.setSelectionRange(pos, pos); } });
    const list = h('div', { class: 'list reftree', 'data-keep-scroll': 'refs' });
    // Drag any row by its handle: onto a row = before it, onto a section's
    // heading = last in that section, onto the lower half of a topic = into it.
    const dnd = refDnd(lib, save, unplaced);
    const row = (key, it, extra) => {
      const info = entryInfo(it);
      return h('div', Object.assign({ class: 'lrow refrow' + (ui.refSel === key ? ' on' : ''), role: 'button', tabindex: '0', 'data-key': key,
        onclick: () => { ui.refSel = key; ui.refConfirmDelete = null; render(); },
        onkeydown: (e) => { if (e.key === 'Enter') { ui.refSel = key; render(); } },
        ondblclick: () => openEntry(it) }, extra),
      dnd.grip(key),
      info.thumb ? h('img', { class: 'refthumb', src: info.thumb, alt: '' }) : h('span', { class: 'ic' }, icon(it.icon || info.icon)),
      h('span', { class: 'tx' }, h('b', {}, info.title), h('small', {}, info.sub)));
    };
    let shown = 0;
    lib.sections.forEach((s, si) => {
      const items = s.items.map((it, ii) => ({ it, ii })).filter(({ it }) => !words.length || hit(s.name + ' ' + entryText(it)));
      if (words.length && !items.length && !hit(s.name)) return;
      list.append(h('div', { class: 'refsec' + (ui.refSel === 'sec:' + si ? ' on' : ''), role: 'button', tabindex: '0', 'data-section': s.name, 'data-key': 'sec:' + si,
        onclick: () => { ui.refSel = 'sec:' + si; ui.refConfirmDelete = null; render(); } },
      dnd.grip('sec:' + si), h('span', { class: 'ic' }, icon(s.icon || 'folder')), h('b', {}, s.name), h('span', { class: 'count' }, String(s.items.length))));
      if (!s.items.length) list.append(h('div', { class: 'refnone' }, 'Empty. Pick the section, then add to it.'));
      const attrs = (it) => { const info = entryInfo(it); return info.kind === 'link' ? { 'data-link': it.name } : info.ref ? { 'data-ref': info.ref.id } : {}; };
      for (const { it, ii } of items) {
        if (it.topic) {
          list.append(h('div', { class: 'lrow refrow reftopic' + (ui.refSel === `it:${si}:${ii}` ? ' on' : ''), role: 'button', tabindex: '0', 'data-topic': it.name, 'data-key': `it:${si}:${ii}`,
            onclick: () => { ui.refSel = `it:${si}:${ii}`; ui.refConfirmDelete = null; render(); } },
          dnd.grip(`it:${si}:${ii}`), h('span', { class: 'ic' }, icon(it.icon || 'topic')),
          h('span', { class: 'tx' }, h('b', {}, it.name), h('small', {}, it.items.length ? `Topic · ${it.items.length} source${it.items.length > 1 ? 's' : ''}` : 'Topic · empty: add to it'))));
          it.items.forEach((x, jj) => {
            if (words.length && !hit(s.name + ' ' + it.name + ' ' + entryText(x))) return;
            list.append(row(`it:${si}:${ii}:${jj}`, x, Object.assign({ class: 'lrow refrow deep' + (ui.refSel === `it:${si}:${ii}:${jj}` ? ' on' : '') }, attrs(x))));
          });
        } else list.append(row(`it:${si}:${ii}`, it, attrs(it)));
        shown++;
      }
    });
    const loose = lib.loose.map((it, i) => ({ it, i })).filter(({ it }) => !words.length || hit(entryText(it)));
    if (loose.length) {
      list.append(h('div', { class: 'kgroup' }, 'Directly on the ring'));
      for (const { it, i } of loose) { list.append(row('loose:' + i, it, { 'data-link': it.name })); shown++; }
    }
    if (!words.length && lib.tools.length) {
      list.append(h('div', { class: 'kgroup' }, 'Tools on the ring (after the sections)'));
      lib.tools.forEach((t, ti) => list.append(h('div', { class: 'lrow refrow' + (ui.refSel === 'tool:' + ti ? ' on' : ''), role: 'button', tabindex: '0', 'data-key': 'tool:' + ti, 'data-tool': t.name,
        onclick: () => { ui.refSel = 'tool:' + ti; ui.refConfirmDelete = null; render(); } },
      dnd.grip('tool:' + ti), h('span', { class: 'ic' }, icon(t.icon || 'build')),
      h('span', { class: 'tx' }, h('b', {}, t.name), h('small', {}, Array.isArray(t.items) ? `${t.items.length} inside` : 'Tool')))));
    }
    const free = unplaced.filter((r) => !words.length || hit(r.title + ' ' + (r.tags || []).join(' ') + ' ' + r.body));
    if (free.length) {
      list.append(h('div', { class: 'kgroup' }, 'Not in a section'));
      for (const r of free) {
        const it = refEntry(r);
        list.append(row('ref:' + r.id, it, { 'data-ref': r.id }));
        shown++;
      }
    }
    if (words.length && !shown && !list.children.length) list.append(h('div', { class: 'empty' }, 'Nothing matches.'));
    const listCard = h('div', { class: 'card reflist' },
      h('div', { class: 'searchbox' }, msym('search'), search),
      list,
      h('div', { class: 'addrow' }, h('button', { class: 'btn small', id: 'refNewSection', onclick: () => newSection(lib, save) }, msym('create_new_folder'), 'New section'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost', id: 'refExport', title: 'A copy of your library as an ordinary folder: a folder per section, files and pictures under their titles, links as shortcuts. For a backup or a colleague.',
          onclick: async () => {
            if (dirty.menu) return toast('Save first: the export is of the saved library.');
            const x = await api.refExport();
            if (x.ok) toast(`Exported ${x.files} item${x.files === 1 ? '' : 's'} to ${x.dir}`);
            else if (!x.canceled) toast('Not exported: ' + x.error);
          } }, msym('drive_folder_upload'), 'Export library...')));

    dnd.wire(list);
    let editor;
    if (!cur) editor = h('div', { class: 'card editor refeditor' }, h('div', { class: 'empty' }, 'Make a section, then add to it.'));
    else if (cur.kind === 'tool') editor = toolEditor(cur, lib, save);
    else if (cur.kind === 'sec') editor = sectionEditor(lib, cur.sec, save);
    else if (cur.kind === 'topic') editor = topicEditor(cur, lib, save);
    else if (cur.ref) editor = refEditor(cur, lib, save);
    else if (cur.kind === 'link') editor = linkEditor(cur, lib, save);
    else editor = otherEditor(cur, lib, save);
    // Every entry in a section or topic can move up and down from its editor too.
    if (cur && cur.kind !== 'sec' && cur.kind !== 'topic' && cur.kind !== 'tool' && cur.sec >= 0 && cur.list) editor.append(moveRow(cur, lib, save));
    const grid = h('div', { class: 'refgrid' }, listCard, refSplitter(), editor);
    grid.style.setProperty('--refw', refWidth() + 'px');
    $main.append(grid);
  }

  // The divider between the list and the editor: drag it to share the width,
  // double-click to go back to the default. The width is kept for next time.
  const REF_W = 420;
  function refWidth() {
    let w = REF_W;
    try { w = +localStorage.getItem('rg.refWidth') || REF_W; } catch (e) { /* storage off: default */ }
    return Math.max(260, Math.min(w, 900));
  }
  function refSplitter() {
    const set = (grid, w) => {
      const max = Math.max(260, grid.getBoundingClientRect().width - 380);
      w = Math.round(Math.max(260, Math.min(w, max)));
      grid.style.setProperty('--refw', w + 'px');
      return w;
    };
    const keep = (w) => { try { localStorage.setItem('rg.refWidth', String(w)); } catch (e) { /* storage off */ } };
    return h('div', { class: 'refsplit', id: 'refSplit', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', title: 'Drag to make the list wider or narrower. Double-click: back to the default.',
      onpointerdown: (e) => {
        const bar = e.currentTarget, grid = bar.parentElement;
        const left = grid.getBoundingClientRect().left;
        bar.setPointerCapture(e.pointerId);
        bar.classList.add('dragging');
        let w = refWidth();
        const mv = (ev) => { w = set(grid, ev.clientX - left - 8); };
        const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.classList.remove('dragging'); keep(w); };
        bar.addEventListener('pointermove', mv);
        bar.addEventListener('pointerup', up);
        e.preventDefault();
      },
      ondblclick: (e) => keep(set(e.currentTarget.parentElement, REF_W)),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        keep(set(e.currentTarget.parentElement, refWidth() + (e.key === 'ArrowLeft' ? -20 : 20)));
        e.preventDefault();
      } });
  }

  // The address reflib.move() takes, from a list key, and back.
  function refAddr(key) {
    let m = /^sec:(\d+)$/.exec(key);
    if (m) return { sec: +m[1] };
    m = /^it:(\d+):(\d+)(?::(\d+))?$/.exec(key);
    if (m) return m[3] === undefined ? { sec: +m[1], idx: +m[2] } : { sec: +m[1], idx: +m[2], sub: +m[3] };
    m = /^tool:(\d+)$/.exec(key);
    if (m) return { tool: +m[1] };
    return null;
  }
  const refKey = (a) => (a.tool !== undefined ? 'tool:' + a.tool : a.idx === undefined ? 'sec:' + a.sec : a.sub === undefined ? `it:${a.sec}:${a.idx}` : `it:${a.sec}:${a.idx}:${a.sub}`);

  // Drag and drop in the Reference Library list.
  function refDnd(lib, save, unplaced) {
    let dragKey = null;
    const grip = (key) => h('span', { class: 'grip', draggable: 'true', title: 'Drag to move', 'aria-hidden': 'true',
      onclick: (e) => e.stopPropagation(),
      ondragstart: (e) => { dragKey = key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); e.target.closest('[data-key]').classList.add('dragging'); },
      ondragend: (e) => { dragKey = null; const r = e.target.closest('[data-key]'); if (r) r.classList.remove('dragging'); } }, msym('drag_indicator'));
    // Where a drop on this row would put the dragged thing (or null: not here).
    function target(rowEl, e) {
      const toKey = rowEl.dataset.key;
      const from = dragKey && refAddr(dragKey);
      const to = refAddr(toKey);
      if (!dragKey || !to || dragKey === toKey) return null;
      const free = /^ref:/.test(dragKey);
      if (from && from.tool !== undefined) return to.tool !== undefined ? { to, how: 'before' } : null;
      if (to.tool !== undefined) return null;
      if (from && from.idx === undefined) return to.idx === undefined ? { to, how: 'before' } : null; // a section
      if (!from && !free) return null;
      if (to.idx === undefined) return { to: { sec: to.sec }, how: 'into' }; // a section heading: last in it
      const t = to.sub === undefined && lib.sections[to.sec].items[to.idx];
      const r = rowEl.getBoundingClientRect();
      if (t && t.topic && !(from && from.idx !== undefined && from.sub === undefined && lib.sections[from.sec].items[from.idx].topic) && e.clientY > r.top + r.height / 2)
        return { to: { sec: to.sec, idx: to.idx, end: true }, how: 'into' };
      return { to, how: 'before' };
    }
    const clear = (el) => el.querySelectorAll('.dropbefore, .dropinto').forEach((x) => x.classList.remove('dropbefore', 'dropinto'));
    function wire(listEl) {
      listEl.addEventListener('dragover', (e) => {
        const rowEl = e.target.closest('[data-key]');
        clear(listEl);
        const t = rowEl && target(rowEl, e);
        if (!t) return;
        e.preventDefault();
        rowEl.classList.add(t.how === 'into' ? 'dropinto' : 'dropbefore');
      });
      listEl.addEventListener('dragleave', (e) => { if (!listEl.contains(e.relatedTarget)) clear(listEl); });
      listEl.addEventListener('drop', (e) => {
        const rowEl = e.target.closest('[data-key]');
        const t = rowEl && target(rowEl, e);
        clear(listEl);
        if (!t) return;
        e.preventDefault();
        let at;
        if (/^ref:/.test(dragKey)) {
          // A note, picture or file in no section: into the place it was dropped.
          const r = unplaced.find((x) => 'ref:' + x.id === dragKey);
          const s2 = lib.sections[t.to.sec];
          if (!r || !s2) return;
          const entry = refEntry(r);
          if (t.to.end) { s2.items[t.to.idx].items.push(entry); at = { sec: t.to.sec, idx: t.to.idx, sub: s2.items[t.to.idx].items.length - 1 }; }
          else if (t.to.idx === undefined) { s2.items.push(entry); at = { sec: t.to.sec, idx: s2.items.length - 1 }; }
          else if (t.to.sub !== undefined) { s2.items[t.to.idx].items.splice(t.to.sub, 0, entry); at = t.to; }
          else { s2.items.splice(t.to.idx, 0, entry); at = t.to; }
        } else {
          const from = refAddr(dragKey);
          const to = from.idx === undefined && from.tool === undefined ? { sec: t.to.sec } : t.to;
          at = RL.move(lib, from, to);
          if (!at) return toast('It cannot go there (a topic cannot go inside a topic).');
        }
        dragKey = null;
        save();
        ui.refSel = refKey(at);
        render();
        toast('Moved. Save to keep the new order on the ring.');
      });
    }
    return { grip, wire };
  }

  // Move up / Move down for an entry of a section or a topic.
  function moveRow(cur, lib, save) {
    const from = cur.topic ? { sec: cur.sec, idx: cur.topicIdx, sub: cur.idx } : { sec: cur.sec, idx: cur.idx };
    const go = (d) => {
      const i = from.sub === undefined ? from.idx : from.sub;
      const j = d < 0 ? i - 1 : i + 2;
      if (j < 0 || i + d >= cur.list.length) return;
      const to = from.sub === undefined ? { sec: from.sec, idx: j } : { sec: from.sec, idx: from.idx, sub: j };
      const at = RL.move(lib, from, to); // past the end = last
      if (!at) return;
      save();
      ui.refSel = refKey(at);
      render();
    };
    const i = cur.idx;
    return h('div', { class: 'addrow', style: 'margin-top:10px' },
      h('button', { class: 'btn small', id: 'entryUp', disabled: i <= 0, onclick: () => go(-1) }, msym('arrow_upward'), 'Move up'),
      h('button', { class: 'btn small', id: 'entryDown', disabled: i >= cur.list.length - 1, onclick: () => go(1) }, msym('arrow_downward'), 'Move down'),
      h('span', { class: 'hint' }, cur.topic ? 'Within the topic. Or drag it in the list.' : 'Within the section. Or drag it in the list, even into another section or a topic.'));
  }

  // A tool on the Reference Library ring (Search copied text, My documents...).
  function toolEditor(cur, lib, save) {
    const t = lib.tools[cur.tool];
    const go = (d) => {
      const j = d < 0 ? cur.tool - 1 : cur.tool + 2;
      const at = RL.move(lib, { tool: cur.tool }, { tool: j });
      save();
      ui.refSel = refKey(at);
      render();
    };
    return h('div', { class: 'card editor refeditor', id: 'toolEditor' },
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym('build'), 'Tool'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      h('h2', {}, t.name),
      h('p', { class: 'hint' }, 'A tool on the Reference Library ring, after your sections. Edit what it does in Rings.'),
      h('div', { class: 'addrow' },
        h('button', { class: 'btn small', id: 'toolUp', disabled: cur.tool === 0, onclick: () => go(-1) }, msym('arrow_upward'), 'Move up'),
        h('button', { class: 'btn small', id: 'toolDown', disabled: cur.tool === lib.tools.length - 1, onclick: () => go(1) }, msym('arrow_downward'), 'Move down')));
  }

  // The selection key -> { kind, sec, idx, item, ref } (sec -1: not in a section).
  function parseSel(key, lib, unplaced) {
    if (!key) return null;
    let m = /^sec:(\d+)$/.exec(key);
    if (m) return lib.sections[+m[1]] ? { kind: 'sec', sec: +m[1] } : null;
    m = /^it:(\d+):(\d+)(?::(\d+))?$/.exec(key);
    if (m) {
      const s = lib.sections[+m[1]];
      const it = s && s.items[+m[2]];
      if (!it) return null;
      if (m[3] === undefined) {
        if (it.topic) return { kind: 'topic', sec: +m[1], idx: +m[2], topicIdx: +m[2], item: it, list: s.items };
        return Object.assign({ sec: +m[1], idx: +m[2], item: it, list: s.items }, entryInfo(it));
      }
      const x = it.topic && it.items[+m[3]];
      return x ? Object.assign({ sec: +m[1], topicIdx: +m[2], idx: +m[3], item: x, list: it.items, topic: it }, entryInfo(x)) : null;
    }
    m = /^tool:(\d+)$/.exec(key);
    if (m) return lib.tools[+m[1]] ? { kind: 'tool', tool: +m[1] } : null;
    m = /^loose:(\d+)$/.exec(key);
    if (m) { const it = lib.loose[+m[1]]; return it ? Object.assign({ sec: -2, idx: +m[1], item: it, list: lib.loose }, entryInfo(it)) : null; }
    m = /^ref:(r[a-z0-9]+)$/.exec(key);
    if (m) {
      // A library entry: where it is placed, else on its own.
      for (let si = 0; si < lib.sections.length; si++) {
        const items = lib.sections[si].items;
        for (let ii = 0; ii < items.length; ii++) {
          if (refIdOf(items[ii]) === m[1]) { ui.refSel = `it:${si}:${ii}`; return parseSel(ui.refSel, lib, unplaced); }
          const jj = items[ii].topic ? items[ii].items.findIndex((x) => refIdOf(x) === m[1]) : -1;
          if (jj >= 0) { ui.refSel = `it:${si}:${ii}:${jj}`; return parseSel(ui.refSel, lib, unplaced); }
        }
      }
      const r = unplaced.find((x) => x.id === m[1]);
      return r ? Object.assign({ sec: -1, idx: -1, item: null, list: null }, entryInfo(refEntry(r))) : null;
    }
    return null;
  }

  // Every place something can go: each section, and each topic in it.
  function destinations(lib) {
    const out = [];
    lib.sections.forEach((s, si) => {
      out.push({ key: 's:' + si, label: s.name, list: s.items, sel: (i) => `it:${si}:${i}` });
      s.items.forEach((it, ii) => { if (it.topic) out.push({ key: `t:${si}:${ii}`, label: `${s.name} › ${it.name}`, list: it.items, sel: (j) => `it:${si}:${ii}:${j}` }); });
    });
    return out;
  }
  const curDest = (cur) => (cur.sec < 0 ? 'none' : cur.topicIdx !== undefined && cur.kind !== 'topic' ? `t:${cur.sec}:${cur.topicIdx}` : 's:' + cur.sec);

  const refIdOf = (it) => (/^ref:(r[a-z0-9]+)$/.exec((it && it.action) || '') || [])[1] || '';
  const KIND_ICON = { note: 'description', picture: 'image', pdf: 'picture_as_pdf', file: 'attach_file' };
  const refEntry = (r) => ({ name: r.title.length > 28 ? r.title.slice(0, 27) + '…' : r.title, icon: KIND_ICON[r.kind] || 'description', action: 'ref:' + r.id });

  // What a ring entry is, for the list and the editors.
  function entryInfo(it) {
    const a = String(it.action || '');
    if (a.startsWith('url:')) return { kind: 'link', title: it.name, sub: a.slice(4).replace(/^https?:\/\/(www\.)?/, '').split('/')[0], icon: 'link' };
    const id = refIdOf(it);
    if (id) {
      const r = refById(id);
      if (!r) return { kind: 'gone', title: it.name, sub: 'deleted: remove it', icon: 'help' };
      const sub = { note: 'Note', picture: 'Picture', pdf: 'PDF', file: (r.ext || 'file').toUpperCase() + ' file' }[r.kind] || 'Note';
      return { kind: r.kind, ref: r, title: r.title, sub: [sub].concat(r.tags || []).join(' · '), thumb: r.image || '', icon: KIND_ICON[r.kind] };
    }
    if (a.startsWith('file:')) return { kind: 'doc', title: it.name, sub: a.slice(5), icon: 'folder_open' };
    if (a.startsWith('search:')) return { kind: 'search', title: it.name, sub: 'search', icon: 'search' };
    return { kind: 'other', title: it.name, sub: a.split(':')[0], icon: 'bolt' };
  }
  function entryText(it) {
    if (it.topic) return it.name + ' ' + it.items.map(entryText).join(' ');
    const i = entryInfo(it);
    return [it.name, i.title, i.sub, it.action, i.ref ? i.ref.body : ''].join(' ');
  }
  function openEntry(it) {
    const a = String(it.action || '');
    if (a.startsWith('url:')) return api.openUrl(a.slice(4));
    const id = refIdOf(it);
    if (id) return api.refOpen(id);
    return null;
  }

  // Adding: everything lands in the chosen section (or in none).
  function refAddBar(lib, target, save) {
    const dests = destinations(lib);
    // A place picked here holds while the same thing stays selected.
    const picked = ui.refTargetFor === ui.refSel && ui.refTarget && (ui.refTarget === 'none' || dests.some((d) => d.key === ui.refTarget));
    const to = picked ? ui.refTarget : target;
    const dest = dests.find((d) => d.key === to) || null;
    const place = (r) => {
      if (dest) { dest.list.push(refEntry(r)); save(); ui.refSel = dest.sel(dest.list.length - 1); }
      else ui.refSel = 'ref:' + r.id;
    };
    const add = async (fn, okMsg) => {
      const r = await fn();
      if (!r || !r.ok) { if (r && !r.canceled) toast(r.error); return; }
      await loadRefs();
      for (const x of r.refs || [r.ref]) place(refById(x.id) || x);
      render();
      toast(okMsg + (dest ? ` In ${dest.label}; Save puts it on the ring.` : ''));
    };
    const where = h('select', { id: 'refTarget', onchange: (e) => { ui.refTarget = e.target.value; ui.refTargetFor = ui.refSel; render(); } },
      dests.map((d) => h('option', { value: d.key, selected: d.key === to }, d.label)),
      h('option', { value: 'none', selected: to === 'none' }, 'No section (not on the ring)'));
    return h('div', { class: 'card refadd' },
      h('div', { class: 'addrow', style: 'margin:0;align-items:center' },
        h('span', { class: 'fxlabel' }, 'Add to'), where,
        h('button', { class: 'btn primary', id: 'refNew', onclick: async () => {
          const r = await api.refSave({ title: 'New note', body: '# New note\n\n' });
          await loadRefs();
          place(refById(r.id) || r);
          if (!dest) ui.refSel = 'ref:' + r.id;
          ui.refMode = 'split';
          render();
          const ta = document.getElementById('refBody');
          if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        } }, msym('note_add'), 'Note'),
        h('button', { class: 'btn', id: 'refAddLink', disabled: !dest, title: dest ? 'A website, a journal article...' : 'A link lives on the ring: pick a section', onclick: () => {
          dest.list.push({ name: 'New link', icon: 'menu_book', action: 'url:https://' });
          save();
          ui.refSel = dest.sel(dest.list.length - 1);
          render();
          const n = document.getElementById('linkName');
          if (n) { n.focus(); n.select(); }
        } }, msym('add_link'), 'Link'),
        h('button', { class: 'btn', id: 'refAddFile', title: 'PDFs, pictures, documents: copied into RadGesture, so they open even if the original moves', onclick: () => add(() => api.refAddFile(), 'Added.') }, msym('upload_file'), 'Files or pictures...'),
        h('button', { class: 'btn', id: 'refSnip', title: 'Opens Windows\' snipping: drag over what you want; it is added by itself', onclick: () => { toast('Drag over what you want to keep...'); add(() => api.refSnip(), 'Screenshot added. Give it a title.'); } }, msym('screenshot_region'), 'Snip'),
        h('button', { class: 'btn', id: 'refPaste', title: 'A screenshot or text you copied', onclick: () => add(() => api.refPaste(null), 'Added from the clipboard.') }, msym('content_paste'), 'Paste')),
      h('div', { class: 'hint', style: 'margin-top:10px' }, msym('shield'), ' Keep patient details out: crop names, MRNs and dates out of screenshots. These stay on this PC.'));
  }

  function newSection(lib, save) {
    let n = 1;
    while (lib.sections.some((s) => s.name === (n === 1 ? 'New section' : 'New section ' + n))) n++;
    lib.sections.push({ name: n === 1 ? 'New section' : 'New section ' + n, icon: 'folder', items: [] });
    save();
    ui.refSel = 'sec:' + (lib.sections.length - 1);
    ui.refTarget = null;
    render();
    const el = document.getElementById('secName');
    if (el) { el.focus(); el.select(); }
  }

  function sectionEditor(lib, si, save) {
    const s = lib.sections[si];
    const box = h('div', { class: 'card editor refeditor', id: 'secEditor' });
    const move = (d) => {
      const j = si + d;
      if (j < 0 || j >= lib.sections.length) return;
      [lib.sections[si], lib.sections[j]] = [lib.sections[j], lib.sections[si]];
      save();
      ui.refSel = 'sec:' + j;
      render();
    };
    const refsIn = s.items.filter((it) => refIdOf(it)).length;
    box.append(
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym('folder'), 'Section'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      field('Name', h('input', { type: 'text', id: 'secName', value: s.name, maxlength: 40, oninput: (e) => {
        s.name = e.target.value || 'Section';
        save();
        const head = document.querySelector('.refsec.on');
        if (head) { head.dataset.section = s.name; head.querySelector('b').textContent = s.name; }
        document.querySelectorAll(`#refTarget option[value="s:${si}"]`).forEach((o) => { o.textContent = s.name; });
      } }), 'The heading here, and the name on the ring.'),
      field('Icon', iconPicker(s.icon, (v) => { s.icon = v; save(); render(); })),
      h('div', { class: 'addrow' },
        h('button', { class: 'btn small', id: 'secUp', disabled: si === 0, onclick: () => move(-1) }, msym('arrow_upward'), 'Move up'),
        h('button', { class: 'btn small', id: 'secDown', disabled: si === lib.sections.length - 1, onclick: () => move(1) }, msym('arrow_downward'), 'Move down')),
      h('p', { class: 'hint' }, s.items.length
        ? `${s.items.length} in it. On the ring: Reference Library › ${s.name}${s.items.length > RL.MAX ? ' (the ones past 7 sit under "More")' : ''}. Add to it with the buttons above.`
        : 'Empty: it waits off the ring until you add something. Add to it with the buttons above.'),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('span', { class: 'grow' }),
        ui.refConfirmDelete === 'sec:' + si
          ? h('span', { class: 'confirm' }, s.items.length ? `Delete "${s.name}"? Its links go; ${refsIn ? 'its notes, pictures and files stay, in no section.' : 'nothing else is lost.'}` : `Delete "${s.name}"?`,
            h('button', { class: 'btn small danger', id: 'secDeleteYes', onclick: () => {
              lib.sections.splice(si, 1);
              save();
              ui.refConfirmDelete = null;
              ui.refSel = lib.sections.length ? 'sec:' + Math.max(0, si - 1) : null;
              render();
            } }, 'Delete'),
            h('button', { class: 'btn small ghost', onclick: () => { ui.refConfirmDelete = null; render(); } }, 'Keep'))
          : h('button', { class: 'btn ghost danger', id: 'secDelete', onclick: () => { ui.refConfirmDelete = 'sec:' + si; render(); } }, msym('delete'), 'Delete section')));
    return box;
  }

  // "Section" for anything: moves it to another section or topic (or out of all).
  function sectionPicker(cur, lib, save, { allowNone }) {
    const dests = destinations(lib);
    const here = curDest(cur);
    return field('Section', h('select', { id: 'refSection', onchange: (e) => {
      const d = dests.find((x) => x.key === e.target.value);
      const item = cur.item || refEntry(cur.ref);
      if (cur.list) cur.list.splice(cur.idx, 1);
      if (d) {
        // Splicing above may have shifted it: find the list again.
        const again = destinations(lib).find((x) => x.label === d.label) || d;
        again.list.push(item);
        ui.refSel = again.sel(again.list.length - 1);
      } else ui.refSel = cur.ref ? 'ref:' + cur.ref.id : null;
      save();
      render();
    } },
    dests.map((d) => h('option', { value: d.key, selected: d.key === here }, d.label)),
    allowNone ? h('option', { value: 'none', selected: here === 'none' }, 'No section (not on the ring)') : null),
    allowNone ? 'Where it sits on the ring: a section, or a topic in it. "No section" keeps it here only.' : 'The section, or the topic in it, where it sits.');
  }

  // A section entry becomes a topic holding it, so more sources can join it.
  function makeTopicButton(cur, lib, save) {
    if (cur.sec < 0 || cur.topicIdx !== undefined) return null;
    return h('button', { class: 'btn', id: 'refMakeTopic', title: 'Keep a link, an article and a picture on one subject together', onclick: () => {
      const it = cur.item;
      const title = (entryInfo(it).title || it.name || 'Topic').slice(0, 40);
      cur.list.splice(cur.idx, 1, { name: title, icon: 'topic', topic: true, items: [it] });
      save();
      ui.refSel = `it:${cur.sec}:${cur.idx}`;
      ui.refTarget = null;
      render();
      toast('Now a topic. Add more sources to it with the buttons above.');
    } }, msym('library_add'), 'Make a topic');
  }

  function topicEditor(cur, lib, save) {
    const tp = cur.item;
    const box = h('div', { class: 'card editor refeditor', id: 'topicEditor' });
    const move = (d) => {
      const j = cur.idx + d;
      if (j < 0 || j >= cur.list.length) return;
      [cur.list[cur.idx], cur.list[j]] = [cur.list[j], cur.list[cur.idx]];
      save();
      ui.refSel = `it:${cur.sec}:${j}`;
      render();
    };
    box.append(
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym('topic'), 'Topic'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      field('Name', h('input', { type: 'text', id: 'topicName', value: tp.name, maxlength: 40, oninput: (e) => {
        tp.name = e.target.value || 'Topic';
        save();
        const row = document.querySelector('.reftopic.on');
        if (row) { row.dataset.topic = tp.name; row.querySelector('b').textContent = tp.name; }
        document.querySelectorAll(`#refTarget option[value="t:${cur.sec}:${cur.idx}"]`).forEach((o) => { o.textContent = `${lib.sections[cur.sec].name} › ${tp.name}`; });
      } }), 'Several sources on one subject: a link, an article, a picture. A smaller ring inside its section.'),
      field('Icon', iconPicker(tp.icon || 'topic', (v) => { tp.icon = v; save(); render(); })),
      field('Section', h('select', { id: 'topicSection', onchange: (e) => {
        const to = Number(e.target.value);
        if (to === cur.sec) return;
        cur.list.splice(cur.idx, 1);
        lib.sections[to].items.push(tp);
        save();
        ui.refSel = `it:${to}:${lib.sections[to].items.length - 1}`;
        render();
      } }, lib.sections.map((s, i) => h('option', { value: i, selected: i === cur.sec }, s.name)))),
      h('div', { class: 'addrow' },
        h('button', { class: 'btn small', disabled: cur.idx === 0, onclick: () => move(-1) }, msym('arrow_upward'), 'Move up'),
        h('button', { class: 'btn small', disabled: cur.idx === cur.list.length - 1, onclick: () => move(1) }, msym('arrow_downward'), 'Move down')),
      h('p', { class: 'hint' }, tp.items.length ? `${tp.items.length} source${tp.items.length > 1 ? 's' : ''}. Add more with the buttons above (they go into this topic).` : 'Empty: it waits off the ring until you add a source with the buttons above.'),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('span', { class: 'grow' }),
        ui.refConfirmDelete === 'topic' ? h('span', { class: 'confirm' }, tp.items.length ? 'Remove the topic? Its sources stay, in the section.' : 'Remove the topic?',
          h('button', { class: 'btn small danger', id: 'topicDeleteYes', onclick: () => {
            cur.list.splice(cur.idx, 1, ...tp.items);
            save();
            ui.refConfirmDelete = null;
            ui.refSel = 'sec:' + cur.sec;
            render();
          } }, 'Remove'),
          h('button', { class: 'btn small ghost', onclick: () => { ui.refConfirmDelete = null; render(); } }, 'Keep'))
          : h('button', { class: 'btn ghost danger', id: 'topicDelete', onclick: () => { ui.refConfirmDelete = 'topic'; render(); } }, msym('delete'), 'Remove topic')));
    return box;
  }

  function removeButton(cur, lib, save, label) {
    const key = 'rm:' + cur.sec + ':' + cur.idx;
    return ui.refConfirmDelete === key
      ? h('span', { class: 'confirm' }, 'Remove it from the ring?',
        h('button', { class: 'btn small danger', onclick: () => { cur.list.splice(cur.idx, 1); save(); ui.refConfirmDelete = null; ui.refSel = cur.sec >= 0 ? 'sec:' + cur.sec : null; render(); } }, 'Remove'),
        h('button', { class: 'btn small ghost', onclick: () => { ui.refConfirmDelete = null; render(); } }, 'Keep'))
      : h('button', { class: 'btn ghost danger', id: 'linkRemove', onclick: () => { ui.refConfirmDelete = key; render(); } }, msym('delete'), label || 'Remove');
  }

  function linkEditor(cur, lib, save) {
    const it = cur.item;
    const box = h('div', { class: 'card editor refeditor' });
    box.append(
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym('link'), 'Link'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      field('Name', h('input', { type: 'text', id: 'linkName', value: it.name, oninput: (e) => { it.name = e.target.value; save(); } })),
      field('Address', h('input', { type: 'url', id: 'linkUrl', value: it.action.slice(4), placeholder: 'https://', oninput: (e) => { it.action = 'url:' + e.target.value.trim(); save(); } })),
      cur.sec >= 0 ? sectionPicker(cur, lib, save, { allowNone: false }) : null,
      field('Icon', iconPicker(it.icon, (v) => { it.icon = v; save(); render(); })),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('button', { class: 'btn', id: 'linkOpen', onclick: () => api.openUrl(it.action.slice(4)) }, msym('open_in_new'), 'Open'),
        makeTopicButton(cur, lib, save),
        h('span', { class: 'grow' }),
        removeButton(cur, lib, save)));
    return box;
  }

  // Anything else in a section (a folder or document on this PC, a search...).
  function otherEditor(cur, lib, save) {
    const it = cur.item;
    const box = h('div', { class: 'card editor refeditor' });
    box.append(
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym(cur.kind === 'doc' ? 'folder_open' : 'bolt'), cur.kind === 'doc' ? 'On this PC' : 'Action'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      field('Name', h('input', { type: 'text', id: 'otherName', value: it.name, oninput: (e) => { it.name = e.target.value; save(); } })),
      h('p', { class: 'hint' }, it.action),
      cur.sec >= 0 ? sectionPicker(cur, lib, save, { allowNone: false }) : null,
      field('Icon', iconPicker(it.icon, (v) => { it.icon = v; save(); render(); })),
      h('div', { class: 'addrow', style: 'margin-top:12px' }, h('span', { class: 'grow' }), removeButton(cur, lib, save)));
    return box;
  }

  // The Reference Library ring (id "gallery"; its name may have been changed).
  function refRing() {
    return menuDraft.categories.find((c) => c.id === 'gallery') || menuDraft.categories.find((c) => /reference/i.test(c.name));
  }

  // Where each reference sits on the rings.
  function refPlaces() {
    const out = {};
    menuDraft.categories.forEach((cat) => {
      const walk = (items, p) => (items || []).forEach((it) => {
        if (it.items) walk(it.items, it.more ? p : p.concat(it.name));
        else if (typeof it.action === 'string' && it.action.startsWith('ref:')) (out[it.action.slice(4)] = out[it.action.slice(4)] || []).push(p.concat(it.name).join(' › '));
      });
      walk(cat.items, [cat.name]);
    });
    return out;
  }

  // Ring entries for a note follow its title (the ring shows it).
  function retitleOnRing(id, title) {
    const name = title.length > 28 ? title.slice(0, 27) + '…' : title;
    let changed = false;
    menuDraft.categories.forEach((cat) => {
      const walk = (items) => (items || []).forEach((it) => {
        if (it.items) walk(it.items);
        else if (it.action === 'ref:' + id && it.name !== name) { it.name = name; changed = true; }
      });
      walk(cat.items);
    });
    if (changed) markDirty('menu');
  }

  // A deleted note leaves no direction behind on any ring.
  function dropFromRings(id) {
    let changed = false;
    menuDraft.categories.forEach((cat) => {
      if (cat === refRing()) {
        const lib = RL.read(cat);
        const keep = (list) => list.filter((it) => it.action !== 'ref:' + id);
        lib.sections.forEach((s) => { const n = keep(s.items); if (n.length !== s.items.length) { s.items = n; changed = true; } });
        const l2 = keep(lib.loose);
        if (l2.length !== lib.loose.length) { lib.loose = l2; changed = true; }
        if (changed) RL.pack(cat, lib);
        return;
      }
      const walk = (items) => {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].items) walk(items[i].items);
          else if (items[i].action === 'ref:' + id && items.length > 1) { items.splice(i, 1); changed = true; }
        }
      };
      walk(cat.items || []);
    });
    if (changed) markDirty('menu');
  }

  let refTimer = null;
  function refEditor(cur, lib, saveRing) {
    const r = cur && cur.ref;
    const box = h('div', { class: 'card editor refeditor' });
    if (!r) {
      box.append(h('div', { class: 'empty' }, 'Pick a note or picture on the left, or add one above.'));
      return box;
    }
    const status = h('span', { class: 'hint', id: 'refSaved' }, 'Saved');
    const save = (patch) => {
      Object.assign(r, patch);
      status.textContent = 'Saving...';
      clearTimeout(refTimer);
      refTimer = setTimeout(async () => {
        const back = await api.refSave({ id: r.id, title: r.title, tags: r.tags, body: r.body });
        if (back) { r.updated = back.updated; r.title = back.title; }
        if (patch.title !== undefined) retitleOnRing(r.id, r.title);
        status.textContent = 'Saved';
        const row = document.querySelector(`.refrow[data-ref="${r.id}"] b`);
        if (row) row.textContent = r.title;
      }, 450);
    };
    const mode = ui.refMode || 'split';
    const preview = h('div', { class: 'md refpreview', id: 'refPreview', html: MD.render(r.body) });
    const ta = h('textarea', { id: 'refBody', class: 'refbody', spellcheck: 'true', placeholder: '# Title\n\nWrite here. Headings, **bold**, lists, tables...',
      oninput: (e) => { preview.innerHTML = MD.render(e.target.value); save({ body: e.target.value }); },
      onkeydown: (e) => mdKeys(e, ta) }, r.body);
    const onRing = refPlaces()[r.id] || [];
    const kindChip = { note: ['description', 'Note'], picture: ['image', 'Picture'], pdf: ['picture_as_pdf', 'PDF'], file: ['attach_file', (r.ext || '').toUpperCase() + ' file'] }[r.kind] || ['description', 'Note'];
    box.append(...[
      h('div', { class: 'refhead' },
        h('input', { type: 'text', id: 'refTitle', class: 'reftitle', value: r.title, placeholder: 'Title', oninput: (e) => save({ title: e.target.value }) }),
        status),
      h('div', { class: 'refkind' }, h('span', { class: 'chip' }, msym(kindChip[0]), kindChip[1]), r.fileName ? h('span', { class: 'hint' }, r.fileName) : null),
      sectionPicker(cur, lib, saveRing, { allowNone: true }),
      field('Tags', h('input', { type: 'text', id: 'refTags', value: (r.tags || []).join(', '), placeholder: 'e.g. chest, nodules, guidelines', onchange: (e) => { save({ tags: e.target.value }); setTimeout(() => loadRefs().then(render), 600); } })),
      r.file ? h('div', { class: 'reffile', role: 'button', tabindex: '0', title: 'Open it', onclick: () => api.refOpen(r.id) },
        h('span', { class: 'big' }, msym(r.kind === 'pdf' ? 'picture_as_pdf' : 'draft')),
        h('span', {}, h('b', {}, r.fileName || r.title), h('small', {}, r.kind === 'pdf' ? 'Opens in the reader: zoom, pages, search' : 'Opens in its own program'))) : null,
      r.image ? h('div', { class: 'refpic' }, h('img', { src: (refById(r.id) || r).image, alt: r.title, title: 'Open it to zoom and pan', style: 'cursor:zoom-in', onclick: () => api.refOpen(r.id) }),
        h('div', { class: 'addrow' },
          h('button', { class: 'btn small', onclick: async () => { const x = await api.refPaste(r.id); if (!x.ok) return toast(x.error); await loadRefs(); render(); } }, msym('content_paste'), 'Replace with clipboard'),
          h('button', { class: 'btn small ghost', onclick: async () => { const x = await api.refPickImage(r.id); if (!x.ok) return x.canceled || toast(x.error); await loadRefs(); render(); } }, msym('image'), 'Replace from a file'))) : null,
      h('div', { class: 'reftools' },
        seg([['write', 'Write', 'edit'], ['split', 'Side by side', 'splitscreen'], ['preview', 'Preview', 'visibility']], mode, (v) => { ui.refMode = v; render(); }),
        mode !== 'preview' ? mdToolbar(ta, preview, save) : null),
      r.file ? h('div', { class: 'hint', style: 'margin:8px 0 4px' }, 'Your notes about it:') : null,
      h('div', { class: 'refwork ' + mode }, mode !== 'preview' ? ta : null, mode !== 'write' ? preview : null),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('button', { class: 'btn', id: 'refOpen', onclick: () => api.refOpen(r.id) }, msym('open_in_new'), 'Open'),
        r.image || r.file ? h('button', { class: 'btn ghost', id: 'refShow', title: 'Opens the folder with this file selected', onclick: () => api.refShow(r.id) }, msym('folder_open'), 'Show the file') : null,
        cur.list ? makeTopicButton(cur, lib, saveRing) : null,
        r.image || r.file ? null : h('button', { class: 'btn ghost', onclick: async () => { const x = await api.refPaste(r.id); if (!x.ok) return toast(x.error); await loadRefs(); render(); } }, msym('add_photo_alternate'), 'Add a screenshot'),
        h('span', { class: 'grow' }),
        ui.refConfirmDelete === r.id
          ? h('span', { class: 'confirm' }, 'Delete it?',
            h('button', { class: 'btn small danger', id: 'refDeleteYes', onclick: async () => { await api.refDelete(r.id); dropFromRings(r.id); ui.refConfirmDelete = null; ui.refSel = null; await loadRefs(); render(); toast('Deleted'); } }, 'Delete'),
            h('button', { class: 'btn small ghost', onclick: () => { ui.refConfirmDelete = null; render(); } }, 'Keep'))
          : h('button', { class: 'btn ghost danger', onclick: () => { ui.refConfirmDelete = r.id; render(); } }, msym('delete'), 'Delete')),
      onRing.length ? h('div', { class: 'hint' }, 'On the ring: ' + onRing.join('; ')) : null].filter(Boolean));
    return box;
  }

  // Formatting buttons: wrap the selection, or start the line(s) with a mark.
  function mdToolbar(ta, preview, save) {
    const apply = (fn) => {
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      const r = fn(v, s, e);
      ta.value = r.text;
      ta.focus();
      ta.setSelectionRange(r.s, r.e);
      preview.innerHTML = MD.render(ta.value);
      save({ body: ta.value });
    };
    const wrap = (mark, ph) => apply((v, s, e) => {
      const sel = v.slice(s, e) || ph;
      return { text: v.slice(0, s) + mark + sel + mark + v.slice(e), s: s + mark.length, e: s + mark.length + sel.length };
    });
    const lines = (prefix, numbered) => apply((v, s, e) => {
      const a = v.lastIndexOf('\n', s - 1) + 1;
      const bEnd = v.indexOf('\n', e);
      const b = bEnd < 0 ? v.length : bEnd;
      const strip = (l) => l.replace(/^(#{1,4}\s|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s|>\s?)/, '');
      const block = v.slice(a, b).split('\n').map((l, i) => (numbered ? `${i + 1}. ` : prefix) + strip(l)).join('\n');
      return { text: v.slice(0, a) + block + v.slice(b), s: a, e: a + block.length };
    });
    const insert = (snippet, selFrom, selLen) => apply((v, s) => {
      const lead = s > 0 && v[s - 1] !== '\n' ? '\n\n' : '';
      const text = v.slice(0, s) + lead + snippet + v.slice(s);
      return { text, s: s + lead.length + selFrom, e: s + lead.length + selFrom + selLen };
    });
    const b = (icon, title, fn) => h('button', { class: 'iconbtn mdbtn', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: fn }, msym(icon));
    return h('div', { class: 'mdbar', role: 'toolbar', 'aria-label': 'Formatting' },
      h('button', { class: 'iconbtn mdbtn txt', title: 'Big heading', onmousedown: (e) => e.preventDefault(), onclick: () => lines('# ') }, 'H1'),
      h('button', { class: 'iconbtn mdbtn txt', title: 'Heading', onmousedown: (e) => e.preventDefault(), onclick: () => lines('## ') }, 'H2'),
      h('button', { class: 'iconbtn mdbtn txt', title: 'Small heading', onmousedown: (e) => e.preventDefault(), onclick: () => lines('### ') }, 'H3'),
      b('format_bold', 'Bold (Ctrl+B)', () => wrap('**', 'bold')),
      b('format_italic', 'Italic (Ctrl+I)', () => wrap('*', 'italic')),
      b('highlight', 'Highlight', () => wrap('==', 'key point')),
      b('format_list_bulleted', 'Bullet list', () => lines('- ')),
      b('format_list_numbered', 'Numbered list', () => lines('', true)),
      b('checklist', 'Check list', () => lines('- [ ] ')),
      b('format_quote', 'Pearl / callout', () => lines('> ')),
      b('table', 'Table', () => insert('| Finding | Size | Follow-up |\n|---|---|---|\n| Solid nodule | < 6 mm | None |\n| Solid nodule | 6-8 mm | CT 6-12 mo |\n', 2, 7)),
      b('link', 'Link', () => apply((v, s, e) => { const t = v.slice(s, e) || 'link text'; const md = `[${t}](https://)`; return { text: v.slice(0, s) + md + v.slice(e), s: s + t.length + 3, e: s + t.length + 11 }; })),
      b('horizontal_rule', 'Divider', () => insert('---\n', 4, 0)));
  }

  // Typing helpers: Ctrl+B / Ctrl+I, and lists that continue themselves on
  // Enter (Enter on an empty item ends the list), as in a word processor.
  function mdKeys(e, ta) {
    if ((e.ctrlKey || e.metaKey) && /^[bi]$/i.test(e.key)) {
      e.preventDefault();
      const mark = e.key.toLowerCase() === 'b' ? '**' : '*';
      const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      ta.value = v.slice(0, s) + mark + v.slice(s, en) + mark + v.slice(en);
      ta.setSelectionRange(s + mark.length, en + mark.length);
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const v = ta.value, s = ta.selectionStart;
    const a = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(a, s);
    const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/);
    if (!m) return;
    e.preventDefault();
    if (!m[5].trim()) { // empty item: end the list
      ta.value = v.slice(0, a) + v.slice(s);
      ta.setSelectionRange(a, a);
    } else {
      const next = m[3] ? `${Number(m[3]) + 1}${m[4]} ` : m[2].replace(/\[[xX]\]/, '[ ]');
      const ins = '\n' + m[1] + next;
      ta.value = v.slice(0, s) + ins + v.slice(ta.selectionEnd);
      ta.setSelectionRange(s + ins.length, s + ins.length);
    }
    ta.dispatchEvent(new Event('input'));
  }

  // ---------------------------------------------------------------- General

  function renderGeneral() {
    $main.append(h('h1', {}, 'General'), h('p', { class: 'lede' }, 'How the ring looks and behaves.'));
    const m = menuDraft;
    const labels = m.labels || (m.showLabels === false ? 'never' : 'pause');
    $main.append(themeCard(m));
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'The ring'),
      row('Names around the ring', 'The center always shows the name of what you aim at.',
        seg([['always', 'Always'], ['pause', 'When I pause'], ['never', 'Never']], labels, (v) => { m.labels = v; delete m.showLabels; markDirty('menu'); render(); })),
      row('Open smaller rings by moving past them', 'Move the mouse past a direction that holds more, and its smaller ring opens, also after a tap. Off: click it (or let go on it).',
        sw(m.passOpens !== false, (v) => { if (v) delete m.passOpens; else m.passOpens = false; markDirty('menu'); render(); }, 'Open smaller rings by moving past them')),
      row('Ring buttons under the ring', 'One click jumps to any ring. Off: scroll or click the center instead.',
        sw(m.dock !== false, (v) => { m.dock = v; markDirty('menu'); render(); }, 'Ring buttons under the ring')),
      row('Size', null,
        h('input', { type: 'range', min: '0.8', max: '1.3', step: '0.05', value: String(m.ringScale || 1), style: 'width:220px',
          oninput: (e) => { m.ringScale = parseFloat(e.target.value); markDirty('menu'); e.target.nextSibling.textContent = Math.round(m.ringScale * 100) + '%'; } }),
        h('span', { class: 'hint' }, Math.round((m.ringScale || 1) * 100) + '%')),
      row('Try it', 'Opens the ring here with your unsaved changes.', h('button', { class: 'btn', onclick: () => api.tryRing(menuDraft) }, msym('play_circle'), 'Open the ring'))));
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'RadGesture'),
      row('Start with Windows', null, sw(m.startAtLogin !== false, (v) => { m.startAtLogin = v; markDirty('menu'); render(); }, 'Start with Windows')),
      row('Keep this window on top', 'Settings stays above every other program, also while you try a function in Sectra or PowerScribe. Off: it comes to the front when opened, then behaves like any window.',
        sw(m.settingsOnTop !== false, (v) => { if (v) delete m.settingsOnTop; else m.settingsOnTop = false; markDirty('menu'); api.setOnTop(v); render(); }, 'Keep this window on top')),
      row('Pause the ring', 'Ctrl+CapsLock does nothing while paused. The AI shortcuts keep working.',
        sw(D.status.paused, async (v) => { D.status = await api.setPaused(v); render(); }, 'Pause the ring'))));
  }

  // All dark on purpose (reading rooms are dark). Each tile is a tiny ring
  // drawn with the theme's own variables, so what you pick is what you get.
  function themeCard(m) {
    const cur = T.get(m.theme).id;
    const grid = h('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Theme' });
    for (const t of T.THEMES) {
      const vars = T.cssVars(t.id, 'ring').map(([k, v]) => `${k}:${v}`).join(';');
      const colors = t.palette || m.categories.map((c) => c.color || t.ui.accent);
      const tile = h('div', { class: 'tmini', 'data-lit': t.lit, 'data-fx': t.fx.join(' '), style: `${vars};--accent:${colors[0]};background:${t.ui.bg}` });
      tile.append(h('span', { class: 'tc' }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        tile.append(h('span', { class: 'tn' + (i === 1 ? ' on' : ''), style: `left:${50 + Math.sin(a) * 31}%;top:${50 - Math.cos(a) * 31}%;--accent:${colors[0]}` }));
      }
      const dots = h('span', { class: 'tdots' }, ...colors.slice(0, 5).map((c) => h('i', { style: `background:${c}` })));
      grid.append(h('button', {
        class: 'tpick' + (t.id === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(t.id === cur), 'data-theme-id': t.id,
        onclick: () => { m.theme = t.id; markDirty('menu'); render(); },
      }, tile, h('span', { class: 'tname' }, t.name, dots), h('span', { class: 'tblurb' }, t.blurb)));
    }
    const t = T.get(m.theme);
    return h('div', { class: 'card' },
      h('h2', {}, 'Theme'),
      grid,
      t.palette ? row('Ring colours', `${t.name} gives each ring a colour from its palette.`,
        seg([['theme', "The theme's"], ['mine', 'My own']], m.ringColors === 'mine' ? 'mine' : 'theme', (v) => { if (v === 'mine') m.ringColors = 'mine'; else delete m.ringColors; markDirty('menu'); render(); })) : null);
  }

  // ---------------------------------------------------------------- Status

  function renderStatus() {
    const s = D.status;
    const h0 = s.helper;
    const ok = h0.connected && !s.paused;
    $main.append(h('h1', {}, 'Status'), h('p', { class: 'lede' }, 'Whether the ring shortcut works right now, and what to do if it does not.'));
    let headline, detail;
    if (s.paused) { headline = 'Paused'; detail = 'Turn off "Pause the ring" in General to use Ctrl+CapsLock again.'; }
    else if (h0.connected) { headline = 'Ready'; detail = `Hold ${HK.pretty(scDraft.trigger || '^CapsLock')} anywhere to open the ring.`; }
    else if (h0.running) { headline = 'Starting...'; detail = 'The helper is running but has not checked in yet. If this stays, restart it below.'; }
    else { headline = 'The ring shortcut is not working'; detail = h0.lastError || 'The helper is not running.'; }
    $main.append(h('div', { class: 'card' },
      h('div', { class: 'big' }, h('div', { class: 'orb ' + (ok ? 'good' : 'bad') }, msym(ok ? 'check_circle' : 'error')), h('div', {}, h('h3', {}, headline), h('p', {}, detail))),
      h0.lastError && !h0.connected ? h('pre', { class: 'err' }, h0.lastError) : null,
      s.elevated ? h('p', { class: 'hint', id: 'elevatedNote' }, 'RadGesture is running as administrator. It works, but the next installer may not be able to close it: quit it from the tray icon before updating, and start it normally (not "Run as administrator").') : null,
      h('div', { class: 'addrow', style: 'margin-top:14px' },
        h('button', { class: 'btn', id: 'restartHelper', onclick: async () => { D.status = await api.restartHelper(); toast('Restarting the helper...'); render(); } }, msym('restart_alt'), 'Restart the helper'),
        h('button', { class: 'btn ghost', onclick: () => api.tryRing(null) }, msym('play_circle'), 'Open the ring')),
      h('div', { class: 'hint', style: 'margin-top:10px' },
        `Helper: ${h0.mode === 'bundled' ? 'built in' : h0.mode === 'autohotkey' ? 'using AutoHotkey at ' + h0.autoHotkey : 'not started'}` +
        (h0.lastAction ? ` · last action: ${h0.lastAction.action}` : ''))));

    $main.append(libHealth());
    const c = s.conflicts;
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Old tools that clash'),
      c.length
        ? h('div', {},
          h('p', { style: 'margin:0 0 10px;color:var(--ink-2)' }, 'These are still running and take the same keys as RadGesture. Close them; RadGesture does everything they did.'),
          h('div', { class: 'list' }, c.map((x) => h('div', { class: 'lrow' }, h('span', { class: 'ic' }, msym('block')), h('span', { class: 'tx' }, h('b', {}, x.label), h('small', {}, x.keys))))),
          h('div', { class: 'addrow' },
            h('button', { class: 'btn primary', id: 'closeConflicts', onclick: async () => { D.status = await api.closeConflicts(); toast('Closed'); render(); } }, msym('close'), 'Close them now'),
            c.some((x) => x.kind === 'old-radgesture') ? h('button', { class: 'btn', onclick: () => api.openUninstall() }, msym('delete'), 'Uninstall old RadGesture...') : null))
        : h('div', { class: 'big' }, h('div', { class: 'orb good' }, msym('verified')), h('div', {}, h('h3', {}, 'None found'), h('p', {}, 'No old RadGesture, RadProofread, RadOneLiner or Rad Optimizer script is running.')))
      , h('div', { class: 'addrow' }, h('button', { class: 'btn ghost small', onclick: async () => { D.status = await api.rescan(); render(); } }, msym('refresh'), 'Check again'))));

    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'How to use it'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Hold Ctrl+CapsLock: the ring opens at the mouse.'),
        h('li', {}, 'Move toward a direction and let go to run it. Moving past a direction with dots opens its smaller ring.'),
        h('li', {}, 'Or tap Ctrl+CapsLock and click. The buttons under the ring switch rings (or scroll). Drag the center to move the ring. Esc closes.'),
        h('li', {}, 'Right-click the tray icon for everything else.'))));

    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Recent activity'),
      h('div', { class: 'events' }, s.events.length ? s.events.map((e) => `${new Date(e.t).toLocaleTimeString()}  ${e.type}  ${e.detail}`).join('\n') : 'Nothing yet.'),
      h('div', { class: 'addrow' }, h('button', { class: 'btn ghost small', onclick: () => api.openDataFolder() }, msym('folder_open'), 'Open the settings folder (advanced)'))));
  }

  // Keep the status fresh while the window is open.
  setInterval(async () => {
    const s = await api.status();
    const changed = JSON.stringify([s.helper.connected, s.helper.running, s.conflicts.length, s.paused, s.helper.lastError, s.libHotkeys]) !==
      JSON.stringify([D.status.helper.connected, D.status.helper.running, D.status.conflicts.length, D.status.paused, D.status.helper.lastError, D.status.libHotkeys]);
    D.status = s;
    if (changed) {
      paintStatusDot();
      if (ui.tab === 'status' && !listening) render();
      else if (ui.tab === 'functions' && !listening && !Object.values(dirty).some(Boolean)) {
        const el = document.getElementById('libHealth');
        if (el) el.replaceWith(libHealth());
      }
    }
  }, 2000);

  setTab(ui.tab);
  window.__settingsReady = true;
})();
