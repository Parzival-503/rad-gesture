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
    ['oneliner:indication', 'One-liner: indication'],
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
    if (m) { t = 'references'; ui.refSel = m[1]; refsList = null; ui.refQuery = ''; ui.refTag = ''; ui.refKind = 'all'; }
    ui.tab = t;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
  }
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  api.onTab((t) => setTab(t));

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
    $main.innerHTML = '';
    // Fade in only when the page changes, not on every re-render while editing.
    $main.classList.toggle('fresh', ui.tab !== lastTab);
    lastTab = ui.tab;
    const page = { rings: renderRings, ai: renderAI, shortcuts: renderShortcuts, functions: renderLibrary, workflow: renderWorkflow, references: renderReferences, general: renderGeneral, status: renderStatus }[ui.tab] || renderRings;
    page();
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
    const W = 300, cx = 150, cy = 135, R = 100;
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
    items.forEach((it, i) => {
      const a = slots.items[i];
      const p = G.polar(cx, cy, a, R);
      box.append(h('div', { class: 'n' + (ui.sel === i ? ' on' : ''), title: it.name, style: `left:${p.x}px;top:${p.y}px`, onclick: () => { ui.sel = i; render(); } }, icon(it.icon)));
      const lp = G.polar(cx, cy, a, R + 38);
      box.append(h('div', { class: 't', style: `left:${lp.x}px;top:${lp.y}px` }, it.name.length > 16 ? it.name.slice(0, 15) + '…' : it.name));
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
    $main.append(h('div', { class: 'card' },
      h('h2', {}, 'Prior checklist'),
      h('p', { class: 'hint', style: 'margin:-6px 0 8px' }, 'A short list of what to check on today\'s study, from the prior reports. Copy a prior report, press Add copied prior (repeat for each prior), then Make checklist. Empty the list starts over. On the ring under AI Tools > Prior checklist, and on the toolbar. Not the same as Insert priors on the PACS ring, which fills PowerScribe\'s Comparison field.'),
      row('Forget priors after', 'Stops one patient\'s priors reaching the next checklist.',
        h('input', { type: 'number', min: 0, max: 240, style: 'width:90px', value: a.priorExpireMinutes, oninput: (e) => { a.priorExpireMinutes = String(Math.max(0, parseInt(e.target.value || '0', 10))); markDirty('ai'); } }),
        h('span', { class: 'hint' }, 'minutes idle (0 = never)')),
      row('Adding a prior takes', null,
        seg([['clipboard', 'What I copied'], ['selectall', 'Select all + copy']], a.priorCapture, (v) => { a.priorCapture = v; markDirty('ai'); render(); })),
      row('Show the toolbar at startup', 'The small window with the prior checklist, the one-liner\'s chart text, Impression and One-liner.', sw(a.toolbarAtStartup === '1', (v) => { a.toolbarAtStartup = v ? '1' : '0'; markDirty('ai'); render(); }, 'Show toolbar at startup'))));
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
      h('p', { class: 'lede' }, 'Your own notes and screenshots, next to the guideline links on the Reference Library ring. Write a note with headings, lists and tables, or snip a table from a paper, then put it on the ring: it opens in a clean window over whatever you are reading.'));
    if (!refsList) {
      $main.append(h('div', { class: 'empty' }, 'Loading...'));
      loadRefs().then(() => { if (ui.tab === 'references') render(); });
      return;
    }
    const add = async (fn, okMsg) => {
      const r = await fn();
      if (!r || !r.ok) { if (r && !r.canceled) toast(r.error); return; }
      await loadRefs();
      ui.refSel = r.ref.id;
      render();
      toast(okMsg);
    };
    $main.append(h('div', { class: 'card refadd' },
      h('div', { class: 'addrow', style: 'margin:0' },
        h('button', { class: 'btn primary', id: 'refNew', onclick: async () => {
          const r = await api.refSave({ title: 'New note', body: '# New note\n\n' });
          await loadRefs();
          ui.refSel = r.id;
          ui.refMode = 'split';
          render();
          const ta = document.getElementById('refBody');
          if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        } }, msym('note_add'), 'New note'),
        h('button', { class: 'btn', id: 'refSnip', title: 'Opens Windows\' snipping: drag over what you want; it is added by itself', onclick: () => { toast('Drag over what you want to keep...'); add(() => api.refSnip(), 'Screenshot added. Give it a title.'); } }, msym('screenshot_region'), 'Snip now'),
        h('button', { class: 'btn', id: 'refPaste', title: 'A screenshot or text you copied', onclick: () => add(() => api.refPaste(null), 'Added from the clipboard.') }, msym('content_paste'), 'Paste screenshot or text'),
        h('button', { class: 'btn', id: 'refPick', onclick: () => add(() => api.refPickImage(null), 'Picture added.') }, msym('add_photo_alternate'), 'Choose a picture...')),
      h('div', { class: 'hint', style: 'margin-top:10px' }, msym('shield'), ' Keep patient details out: crop names, MRNs and dates out of screenshots. These stay on this PC.')));

    // Everything in the Reference Library, in one list: your notes and
    // pictures, and the guideline links that ship on its ring (edited here
    // too; they live in the ring, so they need Save like any ring change).
    const ring = refRing();
    const links = ring ? ringLinks(ring) : [];
    const q = (ui.refQuery || '').trim().toLowerCase();
    const kind = ui.refKind || 'all';
    const tag = ui.refTag || '';
    const tags = [...new Set(refsList.flatMap((r) => r.tags || []))].sort();
    const sections = [...new Set(links.map((l) => l.section))];
    const words = q.split(/\s+/).filter(Boolean);
    const hit = (text) => words.every((w) => text.toLowerCase().includes(w));
    const mine = refsList.filter((r) => (kind === 'all' || (kind === 'pictures' ? !!r.image : kind === 'notes' ? !r.image : false)) &&
      (!tag || (r.tags || []).includes(tag)) && hit(r.title + ' ' + (r.tags || []).join(' ') + ' ' + r.body));
    const shownLinks = links.filter((l) => (kind === 'all' || kind === 'links') && (!tag || tag === l.section) && hit(l.title + ' ' + l.section + ' ' + l.url));
    const valid = (sel) => (sel && sel.startsWith('link:') ? links.some((l) => l.key === sel) : !!refById(sel));
    if (!valid(ui.refSel)) ui.refSel = mine.length ? mine[0].id : shownLinks.length ? shownLinks[0].key : null;
    const places = refPlaces();

    const search = h('input', { type: 'text', id: 'refSearch', class: 'search', placeholder: 'Search titles, tags, sections, text and links', value: ui.refQuery || '',
      oninput: (e) => { ui.refQuery = e.target.value; const pos = e.target.selectionStart; render(); const s2 = document.getElementById('refSearch'); s2.focus(); s2.setSelectionRange(pos, pos); } });
    const nPics = refsList.filter((r) => r.image).length;
    const listCard = h('div', { class: 'card reflist' },
      h('div', { class: 'searchbox' }, msym('search'), search),
      h('div', { style: 'margin:10px 0 6px' }, seg([['all', `All ${refsList.length + links.length}`], ['links', `Links ${links.length}`], ['notes', `Notes ${refsList.length - nPics}`], ['pictures', `Pictures ${nPics}`]], kind, (v) => { ui.refKind = v; render(); })),
      tags.length || sections.length ? h('div', { class: 'fxchips', style: 'margin-bottom:8px' },
        sections.concat(tags).map((t) => h('button', { class: 'fxchip' + (t === tag ? ' on' : ''), onclick: () => { ui.refTag = t === tag ? '' : t; render(); } }, t))) : null);
    const list = h('div', { class: 'list' });
    if (mine.length) list.append(h('div', { class: 'kgroup' }, 'Your notes and pictures'));
    for (const r of mine) {
      list.append(h('div', { class: 'lrow refrow' + (r.id === ui.refSel ? ' on' : ''), role: 'button', tabindex: '0', 'data-ref': r.id,
        onclick: () => { ui.refSel = r.id; render(); }, ondblclick: () => api.refOpen(r.id) },
      r.image ? h('img', { class: 'refthumb', src: r.image, alt: '' }) : h('span', { class: 'ic' }, msym('description')),
      h('span', { class: 'tx' }, h('b', {}, r.title), h('small', {}, [(r.tags || []).join(', '), places[r.id] ? 'on the ring' : ''].filter(Boolean).join(' · ') || new Date(r.updated).toLocaleDateString()))));
    }
    let lastSec = null;
    for (const l of shownLinks) {
      if (l.section !== lastSec) { list.append(h('div', { class: 'kgroup' }, msym('link'), ' ', l.section)); lastSec = l.section; }
      list.append(h('div', { class: 'lrow refrow' + (l.key === ui.refSel ? ' on' : ''), role: 'button', tabindex: '0', 'data-link': l.title,
        onclick: () => { ui.refSel = l.key; render(); }, ondblclick: () => api.openUrl(l.url) },
      h('span', { class: 'ic' }, icon(l.item.icon || 'link')),
      h('span', { class: 'tx' }, h('b', {}, l.title), h('small', {}, l.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]))));
    }
    if (!mine.length && !shownLinks.length) list.append(h('div', { class: 'empty' }, refsList.length + links.length ? 'Nothing matches.' : 'Nothing yet. Start with New note, or snip a table from a paper.'));
    listCard.append(list,
      ring ? h('div', { class: 'addrow' }, h('button', { class: 'btn small', id: 'refAddLink', onclick: () => addRingLink(ring) }, msym('add_link'), 'Add a link')) : null);

    const sel = ui.refSel && ui.refSel.startsWith('link:') ? links.find((l) => l.key === ui.refSel) : null;
    const grid = h('div', { class: 'refgrid' }, listCard, sel ? linkEditor(sel, ring) : refEditor(refById(ui.refSel), places));
    $main.append(grid);
  }

  // The Reference Library ring (id "gallery"; its name may have been changed).
  function refRing() {
    return menuDraft.categories.find((c) => c.id === 'gallery') || menuDraft.categories.find((c) => /reference/i.test(c.name));
  }

  // Its website links ("url:"), with the smaller ring each sits in.
  function ringLinks(ring) {
    const out = [];
    const walk = (items, sec, keyPath) => (items || []).forEach((it, i) => {
      const key = keyPath.concat(i);
      if (it.items) walk(it.items, it.name, key);
      else if (typeof it.action === 'string' && it.action.startsWith('url:')) out.push({ key: 'link:' + key.join('.'), title: it.name, url: it.action.slice(4), section: sec, item: it, parent: items });
    });
    walk(ring.items, ring.name, []);
    return out;
  }

  // A new link, in the first smaller ring with room (else on the ring itself).
  function addRingLink(ring) {
    const target = ring.items.find((it) => it.items && it.items.some((x) => (x.action || '').startsWith('url:')) && it.items.length < M.MAX_ITEMS) ||
      (ring.items.length < M.MAX_ITEMS ? ring : null);
    if (!target) return toast(`Every part of the ${ring.name} ring is full (${M.MAX_ITEMS} each). Make room in Rings.`);
    const items = target.items;
    items.push({ name: 'New link', icon: 'menu_book', action: 'url:https://' });
    markDirty('menu');
    const l = ringLinks(ring).find((x) => x.item === items[items.length - 1]);
    ui.refSel = l ? l.key : null;
    ui.refKind = 'all';
    ui.refQuery = '';
    ui.refTag = '';
    render();
    const n = document.getElementById('linkName');
    if (n) { n.focus(); n.select(); }
  }

  function linkEditor(l, ring) {
    const box = h('div', { class: 'card editor refeditor' });
    const it = l.item;
    const homes = [ring].concat(ring.items.filter((x) => x.items));
    box.append(
      h('div', { class: 'refhead' }, h('span', { class: 'chip' }, msym('link'), 'Link on the ring'), h('span', { class: 'hint' }, 'Changes here are saved with Save.')),
      field('Name', h('input', { type: 'text', id: 'linkName', value: it.name, oninput: (e) => { it.name = e.target.value; markDirty('menu'); } })),
      field('Address', h('input', { type: 'url', id: 'linkUrl', value: l.url, placeholder: 'https://', oninput: (e) => { it.action = 'url:' + e.target.value.trim(); markDirty('menu'); } })),
      field('Section', h('select', { id: 'linkSection', onchange: (e) => {
        const to = homes[Number(e.target.value)];
        if (to.items === l.parent) return;
        if (to.items.length >= M.MAX_ITEMS) { toast(`"${to.name}" is full.`); render(); return; }
        l.parent.splice(l.parent.indexOf(it), 1);
        to.items.push(it);
        markDirty('menu');
        ui.refSel = (ringLinks(ring).find((x) => x.item === it) || {}).key;
        render();
      } }, homes.map((s, i) => h('option', { value: i, selected: s.items === l.parent }, s === ring ? `${ring.name} (the ring itself)` : s.name))),
      'The smaller ring it sits in.'),
      field('Icon', iconPicker(it.icon, (v) => { it.icon = v; markDirty('menu'); render(); })),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('button', { class: 'btn', id: 'linkOpen', onclick: () => api.openUrl(it.action.slice(4)) }, msym('open_in_new'), 'Open'),
        h('span', { class: 'grow' }),
        ui.refConfirmDelete === l.key
          ? h('span', { class: 'confirm' }, 'Remove it from the ring?',
            h('button', { class: 'btn small danger', onclick: () => {
              if (l.parent.length <= 1) { toast('Its section needs at least one link. Delete the section in Rings instead.'); return; }
              l.parent.splice(l.parent.indexOf(it), 1);
              ui.refConfirmDelete = null;
              ui.refSel = null;
              markDirty('menu');
              render();
            } }, 'Remove'),
            h('button', { class: 'btn small ghost', onclick: () => { ui.refConfirmDelete = null; render(); } }, 'Keep'))
          : h('button', { class: 'btn ghost danger', onclick: () => { ui.refConfirmDelete = l.key; render(); } }, msym('delete'), 'Remove')));
    return box;
  }

  // Where each reference sits on the rings.
  function refPlaces() {
    const out = {};
    menuDraft.categories.forEach((cat) => {
      const walk = (items, p) => (items || []).forEach((it) => {
        if (it.items) walk(it.items, p.concat(it.name));
        else if (typeof it.action === 'string' && it.action.startsWith('ref:')) (out[it.action.slice(4)] = out[it.action.slice(4)] || []).push(p.concat(it.name).join(' › '));
      });
      walk(cat.items, [cat.name]);
    });
    return out;
  }

  // Into the Reference Library ring's "My notes" (made on first use).
  function putOnRing(r) {
    const ring = refRing();
    if (!ring) return toast('There is no Reference Library ring. Add a ring in Rings, then use the "Reference" action.');
    let mine = ring.items.find((it) => it.items && it.name === 'My notes');
    const entry = { name: r.title.length > 28 ? r.title.slice(0, 27) + '…' : r.title, icon: r.image ? 'image' : 'description', action: 'ref:' + r.id };
    if (!mine) {
      if (ring.items.length >= M.MAX_ITEMS) return toast(`The ${ring.name} ring is full (${M.MAX_ITEMS}). Make room in Rings first.`);
      mine = { name: 'My notes', icon: 'sticky_note_2', items: [] };
      ring.items.push(mine);
    }
    if (mine.items.length >= M.MAX_ITEMS) return toast('"My notes" is full (8). Make a second smaller ring in Rings.');
    mine.items.push(entry);
    markDirty('menu');
    render();
    toast(`Added to ${ring.name} › My notes. Save to keep it.`);
  }

  let refTimer = null;
  function refEditor(r, places) {
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
    const onRing = places[r.id] || [];
    box.append(...[
      h('div', { class: 'refhead' },
        h('input', { type: 'text', id: 'refTitle', class: 'reftitle', value: r.title, placeholder: 'Title', oninput: (e) => save({ title: e.target.value }) }),
        status),
      field('Tags', h('input', { type: 'text', id: 'refTags', value: (r.tags || []).join(', '), placeholder: 'e.g. chest, nodules, guidelines', onchange: (e) => { save({ tags: e.target.value }); setTimeout(() => loadRefs().then(render), 600); } })),
      r.image ? h('div', { class: 'refpic' }, h('img', { src: (refById(r.id) || r).image, alt: r.title }),
        h('div', { class: 'addrow' },
          h('button', { class: 'btn small', onclick: async () => { const x = await api.refPaste(r.id); if (!x.ok) return toast(x.error); await loadRefs(); render(); } }, msym('content_paste'), 'Replace with clipboard'),
          h('button', { class: 'btn small ghost', onclick: async () => { const x = await api.refPickImage(r.id); if (!x.ok) return x.canceled || toast(x.error); await loadRefs(); render(); } }, msym('image'), 'Replace from a file'))) : null,
      h('div', { class: 'reftools' },
        seg([['write', 'Write', 'edit'], ['split', 'Side by side', 'splitscreen'], ['preview', 'Preview', 'visibility']], mode, (v) => { ui.refMode = v; render(); }),
        mode !== 'preview' ? mdToolbar(ta, preview, save) : null),
      h('div', { class: 'refwork ' + mode }, mode !== 'preview' ? ta : null, mode !== 'write' ? preview : null),
      h('div', { class: 'addrow', style: 'margin-top:12px' },
        h('button', { class: 'btn', id: 'refOpen', onclick: () => api.refOpen(r.id) }, msym('open_in_new'), 'Open'),
        h('button', { class: 'btn', id: 'refRing', onclick: () => putOnRing(r) }, msym('donut_large'), onRing.length ? 'On the ring (add again)' : 'Put on the ring'),
        r.image ? null : h('button', { class: 'btn ghost', onclick: async () => { const x = await api.refPaste(r.id); if (!x.ok) return toast(x.error); await loadRefs(); render(); } }, msym('add_photo_alternate'), 'Add a screenshot'),
        h('span', { class: 'grow' }),
        ui.refConfirmDelete === r.id
          ? h('span', { class: 'confirm' }, 'Delete it?',
            h('button', { class: 'btn small danger', id: 'refDeleteYes', onclick: async () => { await api.refDelete(r.id); ui.refConfirmDelete = null; ui.refSel = null; await loadRefs(); render(); toast('Deleted'); } }, 'Delete'),
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
