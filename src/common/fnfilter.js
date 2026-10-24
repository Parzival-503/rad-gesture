// Search, filters and sorting for Settings > Functions (the function
// collection: the built-in functions plus "My functions"). Shared by the
// Settings window and the tests, so the rules are checked without a browser.
//
// Each function is first turned into a plain "card":
//   { id, name, group, sub, description, custom, programs (['sectra',
//     'powerscribe'] or ['other']), on (shortcut switched on), hotkey, keys
//     (what it presses in the program, hotkey spelling), places (ring paths),
//     clash (its shortcut is also used elsewhere), text (everything searchable) }

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hotkeys'));
  else root.RGFnFilter = factory(root.RGHotkeys);
})(typeof self !== 'undefined' ? self : this, function (HK) {
  const DEFAULTS = { q: '', groups: [], sub: '', shortcut: 'any', ring: 'any', program: 'any', clash: false, key: '', sort: 'group', view: 'tiles' };

  function fresh() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  // How many filters differ from "show everything" (for "Clear filters (3)").
  function activeCount(fx) {
    let n = 0;
    if (fx.q.trim()) n++;
    if (fx.groups.length) n++;
    if (fx.sub) n++;
    for (const k of ['shortcut', 'ring', 'program']) if (fx[k] !== 'any') n++;
    if (fx.clash) n++;
    if (fx.key) n++;
    return n;
  }

  // A shortcut typed as text ("ctrl+alt+p", "Alt+O", "F4") -> "^!p".
  const MOD = { ctrl: '^', control: '^', alt: '!', shift: '+', win: '#' };
  function typedKey(word) {
    const parts = word.toLowerCase().split('+').filter(Boolean);
    if (!parts.length) return '';
    const key = parts.pop();
    if (!parts.every((x) => MOD[x])) return '';
    if (!parts.length && !/^f\d{1,2}$/.test(key)) return ''; // a plain word is a word
    return parts.map((x) => MOD[x]).join('') + key;
  }
  function hasKey(card, spec) {
    return HK.same(card.hotkey, spec) || card.keys.some((k) => HK.same(k, spec));
  }

  // Words, ANDed: "lung win" finds "Lung window". A shortcut typed as text
  // ("ctrl+alt+p", "alt+o", "F4") finds what listens for it or presses it.
  function matchesText(card, q) {
    const words = String(q || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    return words.every((w) => {
      const spec = typedKey(w);
      return spec ? hasKey(card, spec) : card.text.includes(w);
    });
  }

  function matches(card, fx) {
    if (!matchesText(card, fx.q)) return false;
    if (fx.groups.length && !fx.groups.includes(card.group)) return false;
    if (fx.sub && card.sub !== fx.sub) return false;
    if (fx.shortcut === 'on' && !(card.on && card.hotkey)) return false;
    if (fx.shortcut === 'off' && card.on && card.hotkey) return false;
    if (fx.shortcut === 'none' && card.hotkey) return false;
    if (fx.ring === 'on' && !card.places.length) return false;
    if (fx.ring === 'off' && card.places.length) return false;
    if (fx.program !== 'any' && !card.programs.includes(fx.program)) return false;
    if (fx.clash && !card.clash) return false;
    if (fx.key && !hasKey(card, fx.key)) return false;
    return true;
  }

  function sortCards(cards, how) {
    const list = cards.slice();
    if (how === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (how === 'shortcut') {
      // Shortcuts that are on first, by key; then the rest by name.
      const k = (c) => (c.on && c.hotkey ? '0' + HK.pretty(c.hotkey) : '1' + c.name);
      list.sort((a, b) => k(a).localeCompare(k(b)));
    }
    return list;
  }

  function apply(cards, fx) {
    return sortCards(cards.filter((c) => matches(c, fx)), fx.sort);
  }

  // The card for one function. `f` from library.json (or a "My function" shaped
  // like one), `v` its saved values, `places` its ring paths, `clash` boolean.
  function card(f, v, places, clash, code) {
    v = v || {};
    const keys = (f.params || []).filter((p) => p.type === 'key' && v[p.name]).map((p) => {
      const m = String(v[p.name]).match(/^([\^!+#]*)(?:\{([^}]+)\}|(.+))$/);
      return m ? m[1] + (m[2] || m[3]) : '';
    }).filter(Boolean);
    const programs = f.target ? [f.target] : f.uses && f.uses.length ? f.uses.slice() : ['other'];
    const c = {
      id: f.id, name: f.name, group: f.group, sub: f.sub || '', description: f.description || '', custom: !!f.custom,
      programs, on: v.On === '1', hotkey: v.Hotkey || '', keys, places: places || [], clash: !!clash,
    };
    c.text = [c.name, c.group, c.sub, c.description, c.id, c.places.join(' '), c.custom ? 'mine my own custom' : '',
      c.hotkey ? HK.pretty(c.hotkey) : '', keys.map((k) => HK.pretty(k)).join(' '), code || '']
      .join(' ').toLowerCase();
    return c;
  }

  return { DEFAULTS, fresh, activeCount, matches, matchesText, typedKey, sortCards, apply, card };
});
