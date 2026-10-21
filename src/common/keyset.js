// The keys the ring presses (every "helper:keys:..." direction) as one list,
// and shortcut sets: export / import / reset, so the same RadGesture can be
// handed to a colleague whose Sectra (or Rad Optimizer) uses other keys.
// Shared by the Settings window and the tests.
//
// Two spellings of a key combination:
//   hotkey  "^!1", "F4", "w", "^Space"     what the recorder produces
//   send    "^!1", "{F4}", "w", "^{Space}"  what the helper's Send needs
// (named keys and punctuation go in braces, so Send never reads a "+" or "#"
// as Shift or Win).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hotkeys'));
  else root.RGKeyset = factory(root.RGHotkeys);
})(typeof self !== 'undefined' ? self : this, function (HK) {
  const FORMAT = 'radgesture-shortcuts';
  const PREFIX = 'helper:keys:';

  function sendToHotkey(send) {
    const m = String(send || '').match(/^([\^!+#]*)(?:\{([^}]+)\}|(.+))$/);
    return m ? m[1] + (m[2] || m[3]) : '';
  }

  function hotkeyToSend(spec) {
    if (!spec) return '';
    const k = HK.parse(spec);
    if (!k.key) return '';
    const name = HK.pretty(spec).split('+').pop();
    const plain = k.key.length === 1 && /[a-z0-9]/.test(k.key);
    return k.mods + (plain ? k.key : `{${k.key.length === 1 ? k.key : name}}`);
  }

  const isKeys = (it) => it && !it.items && typeof it.action === 'string' && it.action.startsWith(PREFIX);

  // Every direction that presses keys: { path: [ring, ..., name], item, ring, keys }.
  function keyItems(menu) {
    const out = [];
    (menu.categories || []).forEach((cat, ring) => {
      const walk = (items, path) => (items || []).forEach((it) => {
        if (it.items) walk(it.items, path.concat(it.name));
        else if (isKeys(it)) out.push({ path: path.concat(it.name), item: it, ring, keys: sendToHotkey(it.action.slice(PREFIX.length)) });
      });
      walk(cat.items, [cat.name]);
    });
    return out;
  }

  const pathKey = (p) => p.map((s) => String(s).trim().toLowerCase()).join(' > ');

  function setKeys(item, spec) {
    item.action = PREFIX + hotkeyToSend(spec);
  }

  function exportSet(menu, shortcuts) {
    return {
      format: FORMAT,
      version: 1,
      note: 'RadGesture shortcuts. Import it in RadGesture: Settings > Shortcuts > Import.',
      keys: keyItems(menu).map((k) => ({ path: k.path, keys: k.keys })),
      shortcuts: { ...(shortcuts || {}) },
    };
  }

  // Applies a set to `menu` (changed in place) and returns what happened.
  // Directions are matched by their path of names; the ring's layout, icons
  // and everything else stay as they are.
  function importSet(menu, set) {
    if (!set || set.format !== FORMAT || !Array.isArray(set.keys)) {
      return { ok: false, error: 'That file is not a RadGesture shortcut set.' };
    }
    const byPath = new Map(keyItems(menu).map((k) => [pathKey(k.path), k]));
    let matched = 0;
    const unmatched = [];
    for (const e of set.keys) {
      const k = Array.isArray(e.path) && byPath.get(pathKey(e.path));
      if (k) {
        setKeys(k.item, e.keys || '');
        matched++;
      } else if (Array.isArray(e.path)) unmatched.push(e.path.join(' > '));
    }
    return { ok: true, matched, unmatched, shortcuts: set.shortcuts && typeof set.shortcuts === 'object' ? set.shortcuts : null };
  }

  // Back to the keys the default menu ships with, for every direction that
  // exists in both (by path).
  function resetToDefaults(menu, defaultMenu) {
    return importSet(menu, exportSet(defaultMenu, null)).matched;
  }

  function clearAll(menu) {
    const all = keyItems(menu);
    all.forEach((k) => setKeys(k.item, ''));
    return all.length;
  }

  // The same combination on more than one direction.
  function duplicates(menu) {
    const seen = new Map();
    for (const k of keyItems(menu)) {
      if (!k.keys) continue;
      const id = HK.parse(k.keys).mods + '|' + HK.parse(k.keys).key;
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push(k);
    }
    return [...seen.values()].filter((l) => l.length > 1);
  }

  // Plain text for setting up Sectra: one line per direction.
  function cheatSheet(menu) {
    const lines = ['RadGesture: keys the ring presses', ''];
    let last = '';
    for (const k of keyItems(menu)) {
      const group = k.path.slice(0, -1).join(' > ');
      if (group !== last) {
        if (last) lines.push('');
        lines.push(group);
        last = group;
      }
      lines.push(`  ${k.path[k.path.length - 1]}: ${k.keys ? HK.pretty(k.keys) : '(not set)'}`);
    }
    return lines.join('\r\n');
  }

  return { FORMAT, sendToHotkey, hotkeyToSend, keyItems, setKeys, exportSet, importSet, resetToDefaults, clearAll, duplicates, cheatSheet };
});
