// The reference viewer: one note or picture from the Reference library, opened
// from the ring. Read-only; Edit goes to Settings > References. Esc closes.
(function () {
  const api = window.rgv;
  const T = window.RGThemes;
  const MD = window.RGMarkdown;
  const $ = (id) => document.getElementById(id);
  let current = new URLSearchParams(location.search).get('id');

  async function show(id) {
    current = id;
    const { ref, theme } = await api.get(id);
    T.apply(document.documentElement, theme, 'ui');
    const page = $('page');
    page.innerHTML = '';
    if (!ref) {
      $('title').textContent = 'Not found';
      page.innerHTML = '<p>This reference was deleted.</p>';
      return;
    }
    document.title = ref.title;
    $('title').textContent = ref.title;
    $('tags').innerHTML = (ref.tags || []).map((t) => `<span class="chip">${MD.esc(t)}</span>`).join(' ');
    if (ref.image) {
      const img = document.createElement('img');
      img.src = ref.image;
      img.alt = ref.title;
      img.className = 'shot';
      img.title = 'Click: actual size / fit';
      img.addEventListener('click', () => img.classList.toggle('full'));
      page.append(img);
    }
    const body = document.createElement('div');
    body.innerHTML = MD.render(ref.body || ''); // MD escapes everything itself
    page.append(body);
    window.__viewerReady = true;
  }

  // Links open in the browser, never inside this window.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    api.openLink(a.getAttribute('href'));
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  $('close').addEventListener('click', () => api.close());
  $('edit').addEventListener('click', () => api.edit(current));
  api.onShow(show);
  show(current);
})();
