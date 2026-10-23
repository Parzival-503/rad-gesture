// Icons for the ring and the settings window.
//
// An icon is one of:
//   "spellcheck", "pulmonology"...  Material Symbols Rounded (bundled font)
//   "ti:lungs", "ti:brain"...        Tabler Icons (bundled font, MIT; names in
//                                    assets/fonts/tabler-map.js)
//   "img:3fa2c1.png"                 a picture the user added, or a program's own
//                                    icon; kept in %APPDATA%\RadGesture\icons and
//                                    handed in as data: URLs (setImages)
//   "grid:3x2"                       a screen layout, rows x columns as Sectra
//                                    writes it (3 rows, 2 columns), drawn as panes
//   anything else ("🫁")             drawn as text (emoji)
// Older menus used a few hand-made names; LEGACY maps them so those menus
// keep working.
(function (root) {
  const LEGACY = {
    sparkle: 'stars', check: 'spellcheck', quote: 'summarize', lines: 'short_text', target: 'oncology',
    calendar: 'medication', timeline: 'medication', pin: 'assignment', layers: 'layers', plus: 'add',
    list: 'checklist', trash: 'delete_sweep', panel: 'dock_to_left', sliders: 'tune', history: 'history',
    edit: 'edit', book: 'menu_book', lungs: 'pulmonology', organ: 'gastroenterology', wave: 'graphic_eq',
    atom: 'radiology', search: 'search', globe: 'public', folder: 'folder_open', timer: 'timer',
    play: 'play_arrow', stop: 'stop', back: 'arrow_back', contrast: 'contrast', ruler: 'straighten',
    crosshair: 'my_location', grid: 'grid_view', key: 'key', wand: 'wand_stars', mic: 'mic',
    field: 'text_fields', clip: 'content_paste', window: 'web', chat: 'groups', tabs: 'tab', dot: 'circle',
  };

  function isSymbolName(s) {
    return /^[a-z0-9_]+$/.test(s);
  }

  let images = {};
  const tabler = () => root.RG_TABLER || {};

  function setImages(map) {
    images = map || {};
  }

  function resolve(name) {
    const n = String(name || '').trim();
    if (!n) return { kind: 'symbol', value: 'circle' };
    if (n.startsWith('ti:')) return { kind: 'tabler', value: n.slice(3) };
    if (n.startsWith('img:')) return { kind: 'image', value: n.slice(4) };
    const g = /^grid:([1-6])x([1-6])$/.exec(n);
    if (g) return { kind: 'grid', rows: Number(g[1]), cols: Number(g[2]) };
    if (LEGACY[n]) return { kind: 'symbol', value: LEGACY[n] };
    return isSymbolName(n) ? { kind: 'symbol', value: n } : { kind: 'text', value: n };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  // Panes of a layout in a 24x24 box, like a symbol: outlined, lightly filled.
  function gridSvg(cols, rows, c) {
    const gap = 1.6, x0 = 3, size = 18;
    const w = (size - gap * (cols - 1)) / cols, h = (size - gap * (rows - 1)) / rows;
    let cells = '';
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        cells += `<rect x="${(x0 + k * (w + gap)).toFixed(2)}" y="${(x0 + r * (h + gap)).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.2"/>`;
      }
    }
    return `<svg class="gridic${c}" viewBox="0 0 24 24" aria-hidden="true">${cells}</svg>`;
  }

  function icon(name, cls) {
    const r = resolve(name);
    const c = cls ? ' ' + cls : '';
    if (r.kind === 'grid') return gridSvg(r.cols, r.rows, c);
    if (r.kind === 'tabler') {
      const cp = tabler()[r.value];
      if (cp) return `<span class="tabler${c}" aria-hidden="true">&#x${cp.toString(16)};</span>`;
      return `<span class="msym${c}" aria-hidden="true">circle</span>`;
    }
    if (r.kind === 'image') {
      const src = images[r.value];
      if (src) return `<img class="imgic${c}" alt="" src="${esc(src)}">`;
      return `<span class="msym${c}" aria-hidden="true">image</span>`;
    }
    return r.kind === 'symbol'
      ? `<span class="msym${c}" aria-hidden="true">${r.value}</span>`
      : `<span class="emoji${c}" aria-hidden="true">${esc(r.value)}</span>`;
  }

  root.RGIcons = { icon, resolve, setImages, tablerNames: () => Object.keys(tabler()), LEGACY, names: Object.keys(LEGACY) };
})(typeof self !== 'undefined' ? self : this);
