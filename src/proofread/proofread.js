// The proofread window. The report sits on the left with every finding marked
// where it is; the findings are on the right. A finding and its mark are one
// thing: selecting either selects both and brings both into view.
//
// "Find in PowerScribe" asks the helper to open PowerScribe's Find and
// Replace with the phrase (and the fix) filled in; "Copy fix" puts the fix on
// the clipboard. What is ticked off is told to the hub, for the history.
(function () {
  const api = window.rgp;
  const T = window.RGThemes;
  const PM = window.RGProofMatch;
  const $ = (id) => document.getElementById(id);

  let data = { seq: 0, report: '', flags: [] };
  let hits = [];
  let done = new Set();
  let sel = 0;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const msym = (n) => `<span class="msym">${n}</span>`;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function renderReport() {
    $('report').innerHTML = PM.segments(data.report, data.flags)
      .map((s) => (s.idx ? `<mark data-i="${s.idx}">${esc(s.text)}<sup>${s.idx}</sup></mark>` : esc(s.text)))
      .join('');
  }

  function renderCards() {
    const n = data.flags.length;
    if (!n) {
      $('cards').innerHTML = `<div class="empty">${msym('check_circle')}<h2>Nothing to fix</h2>No likely dictation errors in this report.</div>`;
      return;
    }
    $('cards').innerHTML = data.flags.map((f, k) => {
      const i = k + 1;
      const c = PM.context(data.report, hits[k]);
      return `<div class="card" data-i="${i}" tabindex="-1">
        <div class="chead"><span class="num">${i}</span><span class="phrase">${esc(f.phrase || '')}</span>
          <button class="tick" data-act="resolve" title="Resolved (Space)">${msym('check_circle')}</button></div>
        ${c ? `<div class="ctx">${esc(c.before)}<b>${esc(c.match)}</b>${esc(c.after)}</div>`
            : `<div class="missing">${msym('search_off')}Not found word for word in the copied text</div>`}
        ${f.reason ? `<div class="reason">${esc(f.reason)}</div>` : ''}
        ${f.replacement ? `<div class="fix"><span class="old">${esc(f.phrase || '')}</span><span class="msym arrow">arrow_forward</span><span class="new">${esc(f.replacement)}</span></div>` : ''}
        ${f.advice ? `<div class="advice">${esc(f.advice)}</div>` : ''}
        <div class="acts">
          <button class="btn small primary" data-act="find">${msym('find_replace')}${f.replacement ? 'Find &amp; fill fix' : 'Find in PowerScribe'}</button>
          ${f.replacement ? `<button class="btn small" data-act="copy">${msym('content_copy')}Copy fix</button>` : ''}
        </div>
      </div>`;
    }).join('') + '<div class="alldone" id="alldone">All findings resolved.</div>';
  }

  function paintState() {
    const n = data.flags.length;
    const left = n - done.size;
    const pill = $('count');
    pill.textContent = !n ? 'No findings' : left ? `${left} to check` + (done.size ? ` · ${done.size} resolved` : '') : 'All resolved';
    pill.classList.toggle('ok', !left);
    $('hideWrap').style.display = n ? '' : 'none';
    $('keys').style.display = n ? '' : 'none';
    document.querySelectorAll('[data-i]').forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle('done', done.has(i));
      el.classList.toggle('sel', i === sel);
    });
    const ad = $('alldone');
    if (ad) ad.classList.toggle('on', n > 0 && !left);
    document.title = n ? `Proofread – ${left ? left + ' to check' : 'all resolved'}` : 'Proofread';
  }

  // Select finding i; `from` says which side was clicked (the other side scrolls).
  function select(i, from) {
    if (!i) return;
    sel = i;
    paintState();
    const card = document.querySelector(`.card[data-i="${i}"]`);
    const mark = document.querySelector(`mark[data-i="${i}"]`);
    if (card && from !== 'card') card.scrollIntoView({ block: 'nearest' });
    if (mark && from !== 'mark') {
      mark.scrollIntoView({ block: 'center' });
      mark.classList.remove('pulse');
      void mark.offsetWidth; // restart the animation
      mark.classList.add('pulse');
    }
  }

  function toggleDone(i) {
    if (done.has(i)) done.delete(i);
    else done.add(i);
    api.resolved(data.seq, [...done]);
    paintState();
  }

  async function act(what, i) {
    const f = data.flags[i - 1];
    if (!f) return;
    if (what === 'resolve') return toggleDone(i);
    if (what === 'copy') {
      await api.copy(f.replacement || '');
      return toast('Fix copied. Paste it with Ctrl+V.');
    }
    if (what === 'find') {
      const r = await api.find(data.seq, i);
      toast(r && r.ok ? 'Opening Find and Replace in PowerScribe…' : (r && r.error) || 'RadGesture’s helper is not running.');
    }
  }

  function visible() {
    const hide = document.body.classList.contains('hide-done');
    return data.flags.map((_, k) => k + 1).filter((i) => !(hide && done.has(i)));
  }

  function show(d) {
    data = d && d.flags ? d : { seq: 0, report: '', flags: [] };
    T.apply(document.documentElement, d && d.theme, 'ui');
    hits = PM.locate(data.report, data.flags);
    done = new Set();
    sel = 0;
    renderReport();
    renderCards();
    paintState();
    $('report').scrollTop = 0;
    if (data.flags.length) select(1);
  }

  $('cards').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const i = Number(card.dataset.i);
    const btn = e.target.closest('[data-act]');
    if (btn) {
      sel = i;
      paintState();
      act(btn.dataset.act, i);
    } else select(i, 'card');
  });
  $('report').addEventListener('click', (e) => {
    const mark = e.target.closest('mark[data-i]');
    if (mark) select(Number(mark.dataset.i), 'mark');
  });
  $('hideResolved').addEventListener('change', (e) => document.body.classList.toggle('hide-done', e.target.checked));
  $('close').addEventListener('click', () => api.close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return api.close();
    if (e.ctrlKey || e.altKey || e.metaKey || !data.flags.length) return;
    const list = visible();
    const at = list.indexOf(sel);
    if (e.key === 'ArrowDown' || e.key === 'j') select(list[Math.min(list.length - 1, at + 1)] || list[0]);
    else if (e.key === 'ArrowUp' || e.key === 'k') select(list[Math.max(0, at - 1)] || list[0]);
    else if (e.key === 'Enter') act('find', sel);
    else if (e.key === 'c' || e.key === 'C') act('copy', sel);
    else if (e.key === ' ') toggleDone(sel);
    else return;
    e.preventDefault();
  });

  api.onShow(show);
  api.onToast(toast);
  api.get().then(show);
})();
