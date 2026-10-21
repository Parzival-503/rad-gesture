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
  const $main = document.getElementById('main');

  let D = await api.get();
  I.setImages(D.images);
  let menuDraft = clone(D.menu);
  let aiDraft = { ...D.ai };
  let scDraft = { ...D.shortcuts };
  const dirty = { menu: false, ai: false, shortcuts: false };
  const ui = { tab: new URLSearchParams(location.search).get('tab') || 'rings', ring: 0, path: [], sel: null, iconQuery: '', iconOpen: false, showKey: false, testResult: null, confirmConvert: false, keyQuery: '', confirmClear: false };

  const ACCENTS = ['#8fb0ff', '#c79bff', '#f2b84b', '#5cc8d6', '#5fd38d', '#ff8f8f', '#ff9ec7', '#e6e9f0'];
  const HELPER_ACTIONS = [
    ['proofread', 'Proofread the open report'],
    ['impression', 'Write a short impression'],
    ['oneliner', 'One-liner (choose the kind each time)'],
    ['oneliner:full', 'One-liner: full'],
    ['oneliner:oncologic', 'One-liner: oncologic'],
    ['oneliner:treatment', 'One-liner: treatment timeline'],
    ['oneliner:indication', 'One-liner: indication'],
    ['lungrads', 'Lung-RADS (fill the fields)'],
    ['prior:add', 'Add the copied prior'],
    ['prior:checklist', 'Prior checklist'],
    ['prior:clear', 'Clear the priors'],
    ['prior:show', 'Show the priors toolbar'],
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
    ['lungrads', 'Lung-RADS', 'Fills Lung-RADS and Impression in PowerScribe.'],
    ['impression', 'Impression', 'Optional. Also on the ring.'],
    ['priorAdd', 'Add prior', 'Optional. Also on the ring.'],
    ['priorChecklist', 'Prior checklist', 'Optional. Also on the ring.'],
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
    if (a.kind === 'helper') return a.value.startsWith('keys:') ? 'keys' : 'ai';
    return { url: 'web', file: 'file', search: 'search', hub: 'hub', app: 'app' }[a.kind] || 'web';
  }
  function describe(it) {
    if (it.items) return `${it.items.length} inside`;
    const a = M.parseAction(it.action);
    if (!a) return 'no action';
    if (a.kind === 'helper') {
      if (a.value.startsWith('keys:')) return 'presses ' + HK.pretty(sendToHotkey(a.value.slice(5)));
      const f = HELPER_ACTIONS.find(([id]) => id === a.value);
      return f ? f[1] : a.value;
    }
    if (a.kind === 'url') return a.value.replace(/^https?:\/\//, '').slice(0, 40);
    if (a.kind === 'search') return 'search copied text';
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
    const sw = D.externalHotkeys.sibling_fallback;
    if (sw) for (const hk of sw.hotkeys) if (!hk.context) out.push({ key: hk.key, script: sw.script, does: hk.does });
    for (const [k, label] of SHORTCUTS) if (scDraft[k]) out.push({ key: scDraft[k], script: 'RadGesture', does: label, field: k });
    return out;
  }

  // ------------------------------------------------------------------ nav + save bar

  function setTab(t) {
    ui.tab = t;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
  }
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  api.onTab((t) => setTab(t));

  const saveBar = h('div', { class: 'savebar' });
  document.body.append(saveBar);
  function renderSaveBar() {
    const parts = Object.entries(dirty).filter(([, v]) => v).map(([k]) => ({ menu: 'rings', ai: 'AI tools', shortcuts: 'shortcuts' })[k]);
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
    D = await api.get();
    I.setImages(D.images);
    renderSaveBar();
    render();
    toast('Saved');
  }
  function discardAll() {
    menuDraft = clone(D.menu);
    aiDraft = { ...D.ai };
    scDraft = { ...D.shortcuts };
    dirty.menu = dirty.ai = dirty.shortcuts = false;
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

  function render() {
    T.apply(document.documentElement, menuDraft && menuDraft.theme, 'ui');
    $main.innerHTML = '';
    const page = { rings: renderRings, ai: renderAI, shortcuts: renderShortcuts, general: renderGeneral, status: renderStatus }[ui.tab] || renderRings;
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
    const types = [['ai', 'AI tool', 'stars'], ['app', 'Open a program', 'apps'], ['web', 'Website', 'public'], ['search', 'Search copied text', 'search'], ['file', 'File or folder', 'folder_open'], ['keys', 'Press keys', 'keyboard'], ['ring', 'Smaller ring', 'donut_small']];
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
      it.action = { app: 'app:notepad.exe', ai: 'helper:proofread', web: 'url:https://www.google.com', search: 'search:' + SEARCHES[0][1], file: 'file:%USERPROFILE%\\Documents', keys: 'helper:keys:{F4}' }[t];
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
      // A program, shortcut, AutoHotkey script or batch file (RadStopwatch,
      // Rad Optimizer, Epic...). The helper starts it, or brings its window
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
        h('span', { class: 'hint' }, 'Starts it (if it is not running) every time RadGesture starts, e.g. RadStopwatch or your shortcut script.'))));
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
    $main.append(h('h1', {}, 'AI tools'), h('p', { class: 'lede' }, 'Proofread, Impression, One-liner, Prior checklist and Lung-RADS all use these settings.'));
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
      row('Forget priors after', 'Stops one patient\'s priors reaching the next checklist.',
        h('input', { type: 'number', min: 0, max: 240, style: 'width:90px', value: a.priorExpireMinutes, oninput: (e) => { a.priorExpireMinutes = String(Math.max(0, parseInt(e.target.value || '0', 10))); markDirty('ai'); } }),
        h('span', { class: 'hint' }, 'minutes idle (0 = never)')),
      row('Adding a prior takes', null,
        seg([['clipboard', 'What I copied'], ['selectall', 'Select all + copy']], a.priorCapture, (v) => { a.priorCapture = v; markDirty('ai'); render(); })),
      row('Show the priors toolbar at startup', null, sw(a.toolbarAtStartup === '1', (v) => { a.toolbarAtStartup = v ? '1' : '0'; markDirty('ai'); render(); }, 'Show toolbar at startup'))));
  }

  // ---------------------------------------------------------------- Shortcuts
  //
  // Everything a key does, in one place: RadGesture's own shortcuts, and every
  // key a ring direction presses (into Sectra, PowerScribe, Rad Optimizer...).
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
          'In Sectra\'s keyboard shortcut settings, give each tool you want on the ring a key (Sectra\'s own keys work too). The list shows what the ring presses now.',
          h('button', { class: 'btn small', id: 'copyKeyList', onclick: copyKeyList }, msym('content_copy'), 'Copy the list')),
        step(2, 'keyboard', 'Match them here',
          'Under "Keys the ring presses", click each one and press the key you gave it in Sectra. Single keys are fine.'),
        step(3, 'ios_share', 'Share your setup',
          'Export a file colleagues can import, so they only do steps 1-2 once per department.',
          h('button', { class: 'btn small', id: 'exportKeys', onclick: exportKeys }, msym('upload'), 'Export...'),
          h('button', { class: 'btn small', id: 'importKeys', onclick: importKeys }, msym('download'), 'Import...'))));
  }

  async function copyKeyList() {
    await api.copyText(KS.cheatSheet(menuDraft));
    toast('Copied. Paste it anywhere to keep it next to Sectra.');
  }
  async function exportKeys() {
    const r = await api.exportKeys(KS.exportSet(menuDraft, scDraft));
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
    markDirty('menu');
    render();
    toast(`Imported ${res.matched} key${res.matched === 1 ? '' : 's'}` + (res.unmatched.length ? `; ${res.unmatched.length} not in your rings` : '') + '. Save to keep them.');
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
        : h('div', { class: 'big' }, h('div', { class: 'orb good' }, msym('verified')), h('div', {}, h('h3', {}, 'None found'), h('p', {}, 'No old RadGesture, RadProofread, RadOneLiner or Lung-RADS script is running.')))
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
    const changed = JSON.stringify([s.helper.connected, s.helper.running, s.conflicts.length, s.paused, s.helper.lastError]) !==
      JSON.stringify([D.status.helper.connected, D.status.helper.running, D.status.conflicts.length, D.status.paused, D.status.helper.lastError]);
    D.status = s;
    if (changed) {
      paintStatusDot();
      if (ui.tab === 'status' && !listening) render();
    }
  }, 2000);

  setTab(ui.tab);
  window.__settingsReady = true;
})();
