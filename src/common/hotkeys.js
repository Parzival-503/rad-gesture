// Hotkey strings in AutoHotkey syntax ("^!q", "^CapsLock", "!+l"), shared by
// the settings window (recording, display, clash warnings) and the tests.
// Same normalisation as tools/hotkey_audit.py.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RGHotkeys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ORDER = '^!+#';
  const NAME = { '^': 'Ctrl', '!': 'Alt', '+': 'Shift', '#': 'Win' };
  const KEY_NAME = {
    capslock: 'CapsLock', space: 'Space', tab: 'Tab', enter: 'Enter', esc: 'Esc', escape: 'Esc',
    backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
    pgup: 'PgUp', pgdn: 'PgDn', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    wheelup: 'WheelUp', wheeldown: 'WheelDown',
  };

  function parse(spec) {
    let s = String(spec || '').trim();
    const flags = { passthrough: false, wildcard: false };
    while (s && '~*$'.includes(s[0])) {
      if (s[0] === '~') flags.passthrough = true;
      if (s[0] === '*') flags.wildcard = true;
      s = s.slice(1);
    }
    const mods = new Set();
    while (s.length > 1 && '^!+#<>'.includes(s[0])) {
      if (ORDER.includes(s[0])) mods.add(s[0]);
      s = s.slice(1);
    }
    let up = false;
    if (/ up$/i.test(s)) {
      up = true;
      s = s.slice(0, -3);
    }
    const key = s.trim().replace(/^\{|\}$/g, '').toLowerCase();
    return { mods: [...ORDER].filter((m) => mods.has(m)).join(''), key, up, ...flags };
  }

  function same(a, b) {
    const x = parse(a), y = parse(b);
    return x.key !== '' && x.mods === y.mods && x.key === y.key && x.up === y.up;
  }

  function pretty(spec) {
    if (!spec) return '';
    const k = parse(spec);
    let key = KEY_NAME[k.key] || (k.key.length === 1 || /^f\d+$/.test(k.key) ? k.key.toUpperCase() : k.key[0].toUpperCase() + k.key.slice(1));
    return [...k.mods].map((m) => NAME[m]).concat([key]).join('+');
  }

  // A browser keydown -> AutoHotkey hotkey string, or '' while only modifiers
  // are held. Needs at least one modifier unless it is an F-key.
  function fromEvent(e) {
    const code = e.code || '';
    if (/^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(code) || ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';
    let key = '';
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^Numpad\d$/.test(code)) key = 'Numpad' + code.slice(6);
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else {
      const map = { CapsLock: 'CapsLock', Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace',
        Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
        ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-',
        Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
      key = map[code] || '';
    }
    if (!key) return '';
    const mods = (e.ctrlKey ? '^' : '') + (e.altKey ? '!' : '') + (e.shiftKey ? '+' : '') + (e.metaKey ? '#' : '');
    if (!mods && !/^F\d+$/.test(key)) return '';
    return mods + (key.length > 1 ? key : key);
  }

  // Which known hotkeys clash with `spec`? `known` = [{key, script, does}].
  function clashes(spec, known, ignoreScript) {
    if (!spec) return [];
    return known.filter((h) => h.script !== ignoreScript && same(h.key, spec));
  }

  return { parse, same, pretty, fromEvent, clashes };
});
