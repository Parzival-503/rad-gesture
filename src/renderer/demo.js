// Browser-only stand-in for the hub, used by the clickable preview page.
// Holding the mouse button (or Space) plays the part of holding Ctrl+CapsLock.
(function () {
  if (window.radgesture) return; // inside the real app: nothing to fake
  const ring = window.RGRing;
  const menu = window.RG_DEMO_MENU;
  let holding = false;
  let last = { x: innerWidth / 2, y: innerHeight / 2 };
  let toastTimer = null;

  function toast(text) {
    const t = document.getElementById('toast');
    t.innerHTML = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function describe(item) {
    const a = window.RGMenu.parseAction(item.action) || { kind: '?', value: item.action };
    const what = {
      helper: 'the helper runs it on your workstation',
      url: 'opens the website',
      file: 'opens the file or folder',
      search: 'searches the copied text',
      hub: 'hub command',
    }[a.kind] || '';
    return `<b>${item.name}</b><span>${what}</span>`;
  }

  ring.hooks.select = (item) => toast(describe(item));
  ring.hooks.dismiss = () => {};

  function startHold(x, y) {
    if (ring.state()) return false;
    holding = true;
    ring.open({ x, y, menu, category: 0 });
    document.body.classList.add('ring-open');
    return true;
  }

  function endHold() {
    if (!holding) return;
    holding = false;
    const r = ring.release();
    if (r.type === 'select') toast(describe(r.item));
  }

  const onCard = (e) => e.target.closest && e.target.closest('.card');

  window.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    if (e.button !== 0 || onCard(e)) return;
    if (startHold(e.clientX, e.clientY)) e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointermove', (e) => (last = { x: e.clientX, y: e.clientY }), true);
  window.addEventListener('pointerup', () => endHold(), true);
  window.addEventListener('pointercancel', () => endHold(), true);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      startHold(last.x, last.y);
    } else if (e.key === 'Escape' && ring.state()) {
      ring.clear();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') endHold();
  });

  // The page clears its "ring open" hint once the ring goes away.
  setInterval(() => document.body.classList.toggle('ring-open', !!ring.state()), 200);
})();
