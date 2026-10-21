// RadGesture themes. All dark: radiologists read in a dark room, so there is
// no light theme on purpose. One list feeds the ring, the Settings window
// and the theme picker, so a theme can never look different in one of them.
//
// A theme is a set of CSS variables (`ring` for the overlay, `ui` for
// Settings), a palette that colours the rings in order (unless the menu says
// `ringColors: "mine"`), and a few effects the CSS keys off:
//   lit: 'fill'    the aimed direction fills with the ring colour (Graphite)
//        'outline' it stays dark and its edge and icon glow (the neon looks)
//   fx:  'scan'    CRT scan lines over the center
//        'pulse'   the aimed direction's glow breathes
//        'glass'   see-through buttons with a bright rim
// UMD: required by tests and main, loaded as a <script> by both pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RGThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SANS = '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif';
  const MONO = '"Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", monospace';
  const TECH = '"Bahnschrift", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

  const THEMES = [
    {
      id: 'graphite',
      name: 'Graphite',
      blurb: 'The calm original. Each ring keeps the colour you gave it.',
      lit: 'fill', fx: [], font: SANS,
      palette: null,
      ring: { node: '#1d2028', nodeHi: '#262a34', edge: 'rgba(255,255,255,0.09)', ink: '#f1f3f8', inkDim: 'rgba(241,243,248,0.66)', nodeInk: '#dfe4ee', centerA: '#22252e', centerB: '#15171d', halo: '8,9,12', sep: 'rgba(255,255,255,0.07)', glow: 1 },
      ui: { bg: '#111318', panel: '#171a21', card: '#1c2028', cardHi: '#232833', line: 'rgba(255,255,255,0.07)', lineHi: 'rgba(255,255,255,0.14)', ink: '#eef1f6', ink2: '#b4bccb', ink3: '#7d8696', accent: '#8fb0ff' },
    },
    {
      id: 'synthwave',
      name: 'Synthwave',
      blurb: 'Hot pink and electric cyan on violet night.',
      lit: 'outline', fx: ['pulse'], font: TECH,
      palette: ['#ff3df2', '#22e6ff', '#ffe14d', '#a47bff', '#ff6b9a', '#3dffb5', '#ff9a3d', '#e8e6ff'],
      ring: { node: '#160b26', nodeHi: '#221238', edge: 'rgba(255,61,242,0.28)', ink: '#fbeaff', inkDim: 'rgba(251,234,255,0.66)', nodeInk: '#e6d4ff', centerA: '#2a1145', centerB: '#0e0619', halo: '10,3,22', sep: 'rgba(255,61,242,0.14)', glow: 1.5 },
      ui: { bg: '#0d0618', panel: '#130a22', card: '#1a0e2e', cardHi: '#24143e', line: 'rgba(255,61,242,0.13)', lineHi: 'rgba(255,61,242,0.3)', ink: '#fbeaff', ink2: '#cdb6e6', ink3: '#8f78ac', accent: '#ff3df2' },
    },
    {
      id: 'grid',
      name: 'Grid',
      blurb: 'Cyan light-lines on pure black, with an orange counterpart.',
      lit: 'outline', fx: [], font: TECH,
      palette: ['#3ef0ff', '#ff9b3d', '#7dd8ff', '#f5f05a', '#5e8bff', '#ff5ad7', '#6dffa8', '#d4f6ff'],
      ring: { node: '#03080b', nodeHi: '#071219', edge: 'rgba(62,240,255,0.42)', ink: '#e4fcff', inkDim: 'rgba(228,252,255,0.62)', nodeInk: '#9fe9f2', centerA: '#06141b', centerB: '#010406', halo: '0,4,6', sep: 'rgba(62,240,255,0.16)', glow: 1.3 },
      ui: { bg: '#020507', panel: '#050c10', card: '#071217', cardHi: '#0b1c24', line: 'rgba(62,240,255,0.12)', lineHi: 'rgba(62,240,255,0.32)', ink: '#e4fcff', ink2: '#9fcbd2', ink3: '#5d8890', accent: '#3ef0ff' },
    },
    {
      id: 'phosphor',
      name: 'Phosphor',
      blurb: 'Green-screen terminal: monospace and soft scan lines.',
      lit: 'outline', fx: ['scan'], font: MONO,
      palette: ['#39ff7a', '#b6ff3b', '#3bffd8', '#e3ff8a', '#7dff5a', '#2bd99a', '#c8ffb0', '#92ffd0'],
      ring: { node: '#04110a', nodeHi: '#08190f', edge: 'rgba(57,255,122,0.32)', ink: '#c9ffd9', inkDim: 'rgba(201,255,217,0.62)', nodeInk: '#7fe0a0', centerA: '#0a2214', centerB: '#020a05', halo: '1,8,4', sep: 'rgba(57,255,122,0.13)', glow: 1.2 },
      ui: { bg: '#030a06', panel: '#05100a', card: '#08170e', cardHi: '#0c2014', line: 'rgba(57,255,122,0.11)', lineHi: 'rgba(57,255,122,0.28)', ink: '#c9ffd9', ink2: '#86cf9f', ink3: '#4f8a63', accent: '#39ff7a' },
    },
    {
      id: 'amber',
      name: 'Amber',
      blurb: 'Old amber monitor. No blue light, easy on night-adapted eyes.',
      lit: 'outline', fx: ['scan'], font: MONO,
      palette: ['#ffb000', '#ff7a1a', '#ffd166', '#ff9440', '#ffc53d', '#ff6a3d', '#ffe39a', '#e89a3c'],
      ring: { node: '#140c02', nodeHi: '#1d1204', edge: 'rgba(255,176,0,0.3)', ink: '#ffe6b8', inkDim: 'rgba(255,230,184,0.62)', nodeInk: '#e9b468', centerA: '#251704', centerB: '#0b0601', halo: '10,6,0', sep: 'rgba(255,176,0,0.13)', glow: 1.15 },
      ui: { bg: '#0b0702', panel: '#110b03', card: '#181005', cardHi: '#221707', line: 'rgba(255,176,0,0.11)', lineHi: 'rgba(255,176,0,0.28)', ink: '#ffe6b8', ink2: '#d2ad74', ink3: '#8f7246', accent: '#ffb000' },
    },
    {
      id: 'abyss',
      name: 'Abyss',
      blurb: 'Deep-sea blue with bioluminescent teal and violet.',
      lit: 'outline', fx: ['pulse'], font: SANS,
      palette: ['#2ef2d0', '#5a9bff', '#b77bff', '#38d6ff', '#7dffb2', '#ff7bd5', '#9fe8ff', '#6f7dff'],
      ring: { node: '#06121f', nodeHi: '#0a1b2e', edge: 'rgba(46,242,208,0.24)', ink: '#e0fbff', inkDim: 'rgba(224,251,255,0.62)', nodeInk: '#9fd8e6', centerA: '#0b2238', centerB: '#030a13', halo: '2,8,16', sep: 'rgba(46,242,208,0.12)', glow: 1.25 },
      ui: { bg: '#040c16', panel: '#06111e', card: '#091829', cardHi: '#0d2136', line: 'rgba(46,242,208,0.1)', lineHi: 'rgba(46,242,208,0.26)', ink: '#e0fbff', ink2: '#9ec4d0', ink3: '#5d8392', accent: '#2ef2d0' },
    },
    {
      id: 'darkroom',
      name: 'Darkroom',
      blurb: 'Dim red only, like a darkroom safelight. Keeps your eyes dark-adapted.',
      lit: 'outline', fx: [], font: SANS,
      palette: ['#ff3b3b', '#ff6a4d', '#d92d5a', '#ff8a6b', '#c43030', '#ff4f7a', '#e05a3a', '#ff9e8a'],
      ring: { node: '#120405', nodeHi: '#1a0607', edge: 'rgba(255,59,59,0.26)', ink: '#ffb3ad', inkDim: 'rgba(255,179,173,0.58)', nodeInk: '#d4706a', centerA: '#210709', centerB: '#090102', halo: '8,0,1', sep: 'rgba(255,59,59,0.12)', glow: 0.9 },
      ui: { bg: '#0a0203', panel: '#100405', card: '#170607', cardHi: '#20090a', line: 'rgba(255,59,59,0.1)', lineHi: 'rgba(255,59,59,0.26)', ink: '#ffc4bf', ink2: '#cf8c86', ink3: '#8a5450', accent: '#ff3b3b' },
    },
    {
      id: 'hologram',
      name: 'Hologram',
      blurb: 'See-through glass with an iridescent rim.',
      lit: 'outline', fx: ['glass'], font: TECH,
      palette: ['#8ff7ff', '#ff9ef0', '#c3a8ff', '#a6ffcf', '#ffd59e', '#9ec4ff', '#ffb3c7', '#e6f7ff'],
      ring: { node: 'rgba(20,32,48,0.55)', nodeHi: 'rgba(40,58,84,0.55)', edge: 'rgba(170,240,255,0.45)', ink: '#f2fcff', inkDim: 'rgba(242,252,255,0.7)', nodeInk: '#cdeefa', centerA: 'rgba(36,54,80,0.7)', centerB: 'rgba(8,14,24,0.75)', halo: '4,10,20', sep: 'rgba(170,240,255,0.16)', glow: 1.1 },
      ui: { bg: '#080d16', panel: '#0c1320', card: '#111b2c', cardHi: '#172438', line: 'rgba(170,240,255,0.1)', lineHi: 'rgba(170,240,255,0.26)', ink: '#f2fcff', ink2: '#b3cad8', ink3: '#6f8796', accent: '#8ff7ff' },
    },
  ];

  const DEFAULT = 'graphite';
  const byId = Object.create(null);
  THEMES.forEach((t) => { byId[t.id] = t; });

  function get(id) {
    return byId[id] || byId[DEFAULT];
  }

  // Colour of ring `i`: the theme's palette in order, unless the person keeps
  // their own colours (or the theme has none, like Graphite).
  function ringColor(menu, i) {
    const t = get(menu && menu.theme);
    const cats = (menu && menu.categories) || [];
    const own = cats[i] && cats[i].color;
    if (t.palette && (!menu || menu.ringColors !== 'mine')) return t.palette[i % t.palette.length];
    return own || t.ui.accent;
  }

  function usesThemeColors(menu) {
    const t = get(menu && menu.theme);
    return !!t.palette && (!menu || menu.ringColors !== 'mine');
  }

  const kebab = (k) => k.replace(/[A-Z0-9]+/g, (m) => '-' + m.toLowerCase());

  // CSS variables for one part ('ring' or 'ui'), as [name, value] pairs.
  function cssVars(id, part) {
    const t = get(id);
    const src = t[part] || {};
    const out = Object.keys(src).map((k) => ['--' + kebab(k), String(src[k])]);
    out.push([part === 'ring' ? '--font' : '--theme-font', t.font]);
    return out;
  }

  // Put a theme on an element: variables, plus data-theme / data-lit /
  // data-fx for the effects the stylesheet keys off.
  function apply(elm, id, part) {
    const t = get(id);
    cssVars(t.id, part).forEach(([k, v]) => elm.style.setProperty(k, v));
    elm.dataset.theme = t.id;
    elm.dataset.lit = t.lit;
    elm.dataset.fx = t.fx.join(' ');
  }

  return { THEMES, DEFAULT, get, ringColor, usesThemeColors, cssVars, apply };
});
