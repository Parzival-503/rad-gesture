// The helper's small windows, one page: ?mode=toolbar | card | pick | toast.
// The hub sends what to show (rgpn:data); buttons go back to the helper.
(function () {
  const api = window.rgpn;
  const T = window.RGThemes;
  const mode = new URLSearchParams(location.search).get('mode') || 'card';
  const $shell = document.getElementById('shell');
  document.body.classList.add('pn-' + mode);
  let data = null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const msym = (n, cls) => h('span', { class: 'msym' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, n);

  // Report the height, so the window fits its content.
  function fit() {
    requestAnimationFrame(() => api.size($shell.scrollHeight + 18));
  }

  // Drag the window by its header (a press on a button stays a click).
  function draggable(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const sx = e.screenX, sy = e.screenY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      api.drag('start', 0, 0);
      const move = (ev) => api.drag('move', ev.screenX - sx, ev.screenY - sy);
      const up = (ev) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.classList.remove('dragging');
        api.drag('end', ev.screenX - sx, ev.screenY - sy);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    return el;
  }

  // A button that tells the helper; it glows for a moment so the click registers.
  function act(id, el) {
    api.act(id);
    if (el) {
      el.classList.add('sent');
      setTimeout(() => el.classList.remove('sent'), 700);
    }
  }
  const iconBtn = (icon, title, onclick, extra) => h('button', Object.assign({ class: 'ib', title, 'aria-label': title, onclick }, extra || {}), msym(icon));

  // ------------------------------------------------------------ toolbar

  function chips(list, letter, removeId, empty) {
    if (!list.length) return h('div', { class: 'none' }, empty);
    return h('div', { class: 'chips' }, list.map((x, i) => h('div', { class: 'chip2', title: x.peek },
      h('b', {}, letter + (i + 1)),
      h('span', { class: 'peek' }, x.peek || '(text)'),
      h('button', { class: 'x', title: 'Remove ' + letter + (i + 1), 'aria-label': 'Remove ' + letter + (i + 1), onclick: (e) => act(removeId + ':' + (i + 1), e.currentTarget) }, msym('close')))));
  }

  function toolbar(d) {
    const P = d.priors || [], C = d.chart || [];
    const collapsed = !!d.collapsed;
    const head = draggable(h('header', { class: 'head' },
      h('span', { class: 'plogo' }, msym('radiology')),
      h('span', { class: 'ttl' }, 'RadGesture'),
      h('span', { class: 'grow' }),
      iconBtn(collapsed ? 'unfold_more' : 'unfold_less', collapsed ? 'Show everything' : 'Make it small', () => { data.collapsed = !collapsed; api.collapse(!collapsed); render(); }, { id: 'tbCollapse' }),
      iconBtn('close', 'Hide the toolbar (ring > AI Tools > Prior checklist > Show toolbar brings it back)', (e) => act('toolbar:hide', e.currentTarget), { id: 'tbClose' })));
    if (collapsed) {
      const badge = (n) => (n ? h('span', { class: 'badge' }, String(n)) : null);
      return [head, h('div', { class: 'tbmini' },
        h('button', { class: 'ib big', title: 'Add prior (highlighted text, or what you copied)', onclick: (e) => act('prior:add', e.currentTarget) }, msym('post_add'), badge(P.length)),
        h('button', { class: 'ib big', title: 'Make the prior checklist', disabled: !P.length, onclick: (e) => act('prior:checklist', e.currentTarget) }, msym('checklist')),
        h('span', { class: 'sep' }),
        h('button', { class: 'ib big', title: 'Add chart text for the one-liner', onclick: (e) => act('chart:add', e.currentTarget) }, msym('playlist_add'), badge(C.length)),
        h('span', { class: 'sep' }),
        h('button', { class: 'ib big', title: 'Impression', onclick: (e) => act('impression', e.currentTarget) }, msym('summarize')),
        h('button', { class: 'ib big', title: 'One-liner', onclick: (e) => act('oneliner', e.currentTarget) }, msym('short_text')))];
    }
    const group = (icon, title, n, ...body) => h('section', { class: 'grp' },
      h('div', { class: 'gh' }, msym(icon), h('span', {}, title), n ? h('span', { class: 'pcount' }, String(n)) : null),
      ...body);
    return [head,
      group('history', 'Prior checklist', P.length,
        chips(P, 'P', 'prior:remove', 'Highlight a prior report, then Add prior.'),
        h('div', { class: 'prow' },
          h('button', { class: 'btn small primary', id: 'tbPriorAdd', onclick: (e) => act('prior:add', e.currentTarget) }, msym('add'), 'Add prior'),
          h('button', { class: 'btn small', id: 'tbChecklist', disabled: !P.length, onclick: (e) => act('prior:checklist', e.currentTarget) }, msym('checklist'), 'Checklist'),
          h('span', { class: 'grow' }),
          iconBtn('delete_sweep', 'Empty the prior list', (e) => act('prior:clear', e.currentTarget), { disabled: !P.length || null, id: 'tbPriorClear' }))),
      group('description', 'One-liner chart text', C.length,
        chips(C, 'C', 'chart:remove', 'Highlight parts of the chart, Add each one, then One-liner.'),
        h('div', { class: 'prow' },
          h('button', { class: 'btn small', id: 'tbChartAdd', onclick: (e) => act('chart:add', e.currentTarget) }, msym('add'), 'Add chart text'),
          h('span', { class: 'grow' }),
          iconBtn('delete_sweep', 'Empty the chart text', (e) => act('chart:clear', e.currentTarget), { disabled: !C.length || null, id: 'tbChartClear' }))),
      group('edit_note', 'Write', 0,
        h('div', { class: 'prow two' },
          h('button', { class: 'btn small', id: 'tbImpression', onclick: (e) => act('impression', e.currentTarget) }, msym('summarize'), 'Impression'),
          h('button', { class: 'btn small', id: 'tbOneLiner', onclick: (e) => act('oneliner', e.currentTarget) }, msym('short_text'), 'One-liner'))),
      h('div', { class: 'foot' }, msym('ads_click'), 'Highlight text, then Add: RadGesture copies it for you.')];
  }

  // ------------------------------------------------------------ card

  function card(d) {
    const kids = [draggable(h('header', { class: 'head' },
      h('span', { class: 'plogo' + (d.error ? ' bad' : '') }, msym(d.error ? 'error' : d.icon || 'auto_awesome')),
      h('div', { class: 'tt' }, h('div', { class: 'ttl' }, d.title || 'RadGesture'), d.sub ? h('div', { class: 'sub' }, d.sub) : null),
      h('span', { class: 'grow' }),
      iconBtn('close', 'Close', () => api.close(), { id: 'cardClose' })))];
    if (d.error) kids.push(h('div', { class: 'errbox' }, d.error));
    if (d.text && d.checks) kids.push(checklist(d));
    else if (d.text) {
      if (d.list) kids.push(h('ul', { class: 'lines' }, d.text.split('\n').filter((l) => l.trim()).map((l) => h('li', {}, l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')))));
      else kids.push(h('div', { class: 'text', id: 'cardText' }, d.text));
    }
    if (d.buttons && d.buttons.length) {
      kids.push(h('div', { class: 'prow acts' }, d.buttons.map((b) => h('button', {
        class: 'btn small' + (b.primary ? ' primary' : ''), 'data-id': b.id,
        onclick: async (e) => {
          const el = e.currentTarget;
          if (b.id === 'copy') {
            await api.copy(d.copy || d.text);
            el.replaceChildren(msym('check'), 'Copied');
            setTimeout(() => el.replaceChildren(msym(b.icon || 'content_copy'), b.label), 1400);
            return;
          }
          if (b.id === 'close') return api.close();
          act(b.id, el);
          if (!b.keep) setTimeout(() => api.close(), 120);
        },
      }, b.icon ? msym(b.icon) : null, b.label))));
    }
    return kids;
  }

  // A checklist the radiologist ticks off as each item goes into the report.
  // Each line is Markdown ("- **Finding**: what to check [P2 3/14/2025]");
  // the source in brackets becomes a small tag. Ticks stay while the same
  // checklist is shown.
  let ticks = { text: null, done: new Set() };
  function checklist(d) {
    if (ticks.text !== d.text) ticks = { text: d.text, done: new Set() };
    const items = d.text.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    const count = h('span', { class: 'clcount', id: 'clCount' });
    const bar = h('span', { class: 'clbar' }, h('i', {}));
    const all = h('div', { class: 'alldone' }, msym('task_alt'), 'All checked');
    const update = () => {
      count.textContent = `${ticks.done.size} of ${items.length} checked`;
      bar.firstChild.style.width = (items.length ? (100 * ticks.done.size) / items.length : 0) + '%';
      all.classList.toggle('on', items.length > 0 && ticks.done.size === items.length);
    };
    const list = h('ul', { class: 'checks' }, items.map((line, i) => {
      const body = h('div', { class: 'ckt' });
      // inline() escapes everything; the tag is added on that escaped text.
      body.innerHTML = window.RGMarkdown.inline(line).replace(/\s*\[(P\d[^\]<]{0,80})\]\s*$/, ' <span class="src">$1</span>');
      const li = h('li', { class: 'ck' + (ticks.done.has(i) ? ' done' : ''), 'data-i': String(i), role: 'checkbox', 'aria-checked': ticks.done.has(i) ? 'true' : 'false',
        onclick: () => {
          if (ticks.done.has(i)) ticks.done.delete(i); else ticks.done.add(i);
          li.classList.toggle('done', ticks.done.has(i));
          li.setAttribute('aria-checked', ticks.done.has(i) ? 'true' : 'false');
          tick.replaceChildren(msym(ticks.done.has(i) ? 'check_circle' : 'radio_button_unchecked'));
          update();
        } });
      const tick = h('span', { class: 'tk' }, msym(ticks.done.has(i) ? 'check_circle' : 'radio_button_unchecked'));
      li.append(tick, body);
      return li;
    }));
    update();
    return h('div', { class: 'cl' }, h('div', { class: 'clhead' }, count, bar), list, all);
  }

  // ------------------------------------------------------------ pick

  let sel = 0;
  function pick(d) {
    const opts = d.options || [];
    sel = Math.min(sel, Math.max(0, opts.length - 1));
    return [draggable(h('header', { class: 'head' },
      h('span', { class: 'plogo' }, msym('short_text')),
      h('div', { class: 'tt' }, h('div', { class: 'ttl' }, d.title || 'Choose'), d.sub ? h('div', { class: 'sub' }, d.sub) : null),
      h('span', { class: 'grow' }),
      iconBtn('close', 'Cancel (Esc)', () => choose(d.cancel)))),
    h('div', { class: 'opts' }, opts.map((o, i) => h('button', { class: 'opt' + (i === sel ? ' on' : ''), 'data-id': o.id, onclick: () => choose(o.id), onmouseenter: () => { sel = i; mark(); } },
      h('kbd', {}, String(i + 1)),
      o.icon ? msym(o.icon) : null,
      h('span', { class: 'ol' }, h('b', {}, o.label), o.hint ? h('span', { class: 'ohint' }, o.hint) : null)))),
    h('div', { class: 'foot' }, h('kbd', {}, '1'), '-', h('kbd', {}, String(opts.length || 1)), ' or ', h('kbd', {}, '↑'), h('kbd', {}, '↓'), h('kbd', {}, 'Enter'), '  ', h('kbd', {}, 'Esc'), ' cancel')];
  }
  function mark() { document.querySelectorAll('.opt').forEach((b, i) => b.classList.toggle('on', i === sel)); }
  function choose(id) {
    if (id) api.act(id);
    api.close();
  }
  window.addEventListener('keydown', (e) => {
    if (mode !== 'pick' || !data) return;
    const opts = data.options || [];
    if (e.key === 'Escape') return choose(data.cancel);
    if (/^[1-9]$/.test(e.key) && opts[Number(e.key) - 1]) return choose(opts[Number(e.key) - 1].id);
    if (e.key === 'ArrowDown') { sel = (sel + 1) % opts.length; mark(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + opts.length) % opts.length; mark(); }
    else if (e.key === 'Enter' && opts[sel]) choose(opts[sel].id);
    else return;
    e.preventDefault();
  });

  // ------------------------------------------------------------ toast

  function toast(d) {
    const icon = { info: 'info', ok: 'check_circle', warn: 'warning', error: 'error' }[d.kind] || 'info';
    return [h('div', { class: 'tst ' + d.kind },
      d.ms === 0 && d.kind === 'info' ? msym('progress_activity', 'spin') : msym(icon),
      h('div', { class: 'ttx' }, d.text))];
  }

  // ------------------------------------------------------------

  function render() {
    if (!data) return;
    T.apply(document.documentElement, data.theme, 'ui');
    const view = { toolbar, card, pick, toast }[mode] || card;
    $shell.replaceChildren(...view(data));
    $shell.classList.toggle('collapsed', mode === 'toolbar' && !!data.collapsed);
    fit();
    if (mode === 'pick') window.focus();
  }
  api.onData((d) => { data = d; if (mode === 'pick') sel = 0; render(); });
  api.get().then((d) => { if (d && !data) { data = d; render(); } });
  window.__panelMode = mode;
})();
