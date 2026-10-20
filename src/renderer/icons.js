// Icons for the ring and the settings window.
//
// An icon is either a Material Symbols name ("spellcheck", "pulmonology"...),
// drawn with the bundled Material Symbols Rounded font, or anything else
// (an emoji like "🫁"), drawn as text. Older menus used a few hand-made
// names; LEGACY maps them so those menus keep working.
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

  function resolve(name) {
    const n = String(name || '').trim();
    if (!n) return { kind: 'symbol', value: 'circle' };
    if (LEGACY[n]) return { kind: 'symbol', value: LEGACY[n] };
    return isSymbolName(n) ? { kind: 'symbol', value: n } : { kind: 'text', value: n };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function icon(name, cls) {
    const r = resolve(name);
    const c = cls ? ' ' + cls : '';
    return r.kind === 'symbol'
      ? `<span class="msym${c}" aria-hidden="true">${r.value}</span>`
      : `<span class="emoji${c}" aria-hidden="true">${esc(r.value)}</span>`;
  }

  root.RGIcons = { icon, resolve, LEGACY, names: Object.keys(LEGACY) };
})(typeof self !== 'undefined' ? self : this);
