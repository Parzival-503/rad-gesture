// Line icons for the ring, drawn on a 24x24 grid. Hand-made for RadGesture.
// Add one by giving it a name here and using that name in menu.json.
(function (root) {
  const P = (d) => d.map((x) => `<path d="${x}"/>`).join('');
  const ICONS = {
    sparkle: P(['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z']),
    check: P(['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M9.5 13.5l2 2 4-4']),
    quote: P(['M6 7h4v4c0 3-1.4 5-4 6', 'M14 7h4v4c0 3-1.4 5-4 6']),
    lines: P(['M4 7h16', 'M4 12h16', 'M4 17h10']),
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    timeline: P(['M3 12h18']) + '<circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>',
    pin: P(['M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z']) + '<circle cx="12" cy="10" r="2"/>',
    layers: P(['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5']),
    plus: P(['M12 5v14', 'M5 12h14']),
    list: P(['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 6l1.2 1.2L7.5 5', 'M4 12l1.2 1.2L7.5 11', 'M4 18l1.2 1.2L7.5 17']),
    trash: P(['M4 7h16', 'M9.5 7V4h5v3', 'M6 7l1 13h10l1-13']),
    panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/>' + P(['M3 9h18']),
    sliders: P(['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1']) +
      '<circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    history: P(['M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3 4v5h5', 'M12 7.5V12l3 2']),
    edit: P(['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4']),
    book: P(['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z', 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19', 'M9 7h6']),
    lungs: P(['M12 3v8', 'M12 11l-2.5 2', 'M12 11l2.5 2', 'M9.5 7C6.5 7 4 11 4 15.5 4 18.5 5 20 7 20s3-1 3-3.5V9', 'M14.5 7c3 0 5.5 4 5.5 8.5 0 3-1 4.5-3 4.5s-3-1-3-3.5V9']),
    organ: P(['M10 3.5C6.5 3.5 4.5 7 4.5 11.5s2.3 9 6 9c2 0 3-1.6 3-3.4 0-1.6-1.3-2.6-1.3-4.3s1.3-2.6 1.3-4.3C13.5 5.6 12 3.5 10 3.5z', 'M17 9.5c1.6 1 2.5 2.6 2.5 4.5']),
    wave: P(['M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0']),
    atom: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-35 12 12)"/>',
    search: '<circle cx="11" cy="11" r="6.5"/>' + P(['M20 20l-4.4-4.4']),
    globe: '<circle cx="12" cy="12" r="9"/>' + P(['M3 12h18', 'M12 3c3.2 3.2 3.2 14.8 0 18', 'M12 3c-3.2 3.2-3.2 14.8 0 18']),
    folder: P(['M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']),
    timer: '<circle cx="12" cy="13.5" r="7.5"/>' + P(['M12 9.5v4l2.5 1.8', 'M9.5 2.5h5', 'M12 2.5v3.5']),
    play: P(['M8 5.5l10.5 6.5L8 18.5z']),
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    back: P(['M19 12H5.5', 'M11 6l-6 6 6 6']),
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/>' + P(['M3.5 10h17', 'M8 3v4', 'M16 3v4', 'M7.5 14h3']),
    contrast: '<circle cx="12" cy="12" r="8.5"/>' + P(['M12 3.5v17', 'M12 7l4.5-2.2', 'M12 11.5l7.5-3', 'M12 16l7.6-3']),
    ruler: P(['M4 15.5L15.5 4 20 8.5 8.5 20z', 'M8 11.5l1.8 1.8', 'M10.8 8.7l1.8 1.8', 'M13.6 5.9l1.8 1.8']),
    crosshair: '<circle cx="12" cy="12" r="7"/>' + P(['M12 2.5v5', 'M12 16.5v5', 'M2.5 12h5', 'M16.5 12h5']),
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    key: '<circle cx="8" cy="15" r="4"/>' + P(['M11 12l8.5-8.5', 'M16.5 6.5l2.5 2.5', 'M14.5 8.5l2 2']),
    wand: P(['M4 20L15 9', 'M13 7l4 4', 'M17 3v3', 'M15.5 4.5h3', 'M20.5 8v3', 'M19 9.5h3']),
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/>' + P(['M5.5 11a6.5 6.5 0 0 0 13 0', 'M12 17.5V21']),
    field: '<rect x="3" y="6" width="18" height="12" rx="2.5"/>' + P(['M7 10v4', 'M11 12h6']),
    clip: '<rect x="6" y="4.5" width="12" height="16" rx="2"/>' + P(['M9.5 3h5v3h-5z', 'M9 11h6', 'M9 15h4']),
    window: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/>' + P(['M3 9h18', 'M6.5 6.8h.01', 'M9 6.8h.01']),
    chat: P(['M4 5.5h16v10H9l-5 4z']),
    tabs: P(['M3 9V6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z', 'M3 10h18']),
    dot: '<circle cx="12" cy="12" r="3"/>',
  };

  function icon(name, cls) {
    const body = ICONS[name] || ICONS.dot;
    return `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  root.RGIcons = { icon, names: Object.keys(ICONS) };
})(typeof self !== 'undefined' ? self : this);
