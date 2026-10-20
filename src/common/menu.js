// Menu model shared by the hub (Node) and the ring (browser).
//
// A menu file is a list of categories. Each category is one ring; the ring's
// center switches between them. A category holds items; an item either runs
// an action or holds more items (a smaller ring that opens in its direction).
//
//   { "categories": [ { "id", "name", "color", "icon", "apps": [...],
//                       "items": [ { "name", "icon", "action" | "items" } ] } ] }
//
// Actions are strings so the file stays easy to edit by hand:
//   helper:<id>      run something in the AutoHotkey helper (AI tools, keys)
//   url:<address>    open a website
//   file:<path>      open a file or folder (%VARS% are expanded)
//   search:<url>     open a website with {clipboard} replaced by copied text
//   hub:<id>         hub commands (edit-menu, open-folder, reload-menu)

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RGMenu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ACTION_KINDS = ['helper', 'url', 'file', 'search', 'hub'];
  const MAX_ITEMS = 8; // more than 8 directions stops being flickable

  function parseAction(action) {
    if (typeof action !== 'string') return null;
    const i = action.indexOf(':');
    if (i < 1) return null;
    const kind = action.slice(0, i);
    const value = action.slice(i + 1);
    if (!ACTION_KINDS.includes(kind) || value === '') return null;
    return { kind, value };
  }

  function validateItems(items, where, errors) {
    if (!Array.isArray(items) || items.length === 0) {
      errors.push(`${where}: needs a non-empty "items" list`);
      return;
    }
    if (items.length > MAX_ITEMS) errors.push(`${where}: has ${items.length} items, the most is ${MAX_ITEMS}`);
    items.forEach((it, n) => {
      const here = `${where} > ${it && it.name ? it.name : '#' + (n + 1)}`;
      if (!it || typeof it !== 'object') return errors.push(`${here}: is not an item`);
      if (typeof it.name !== 'string' || !it.name.trim()) errors.push(`${here}: needs a "name"`);
      const hasAction = it.action !== undefined;
      const hasItems = it.items !== undefined;
      if (hasAction === hasItems) return errors.push(`${here}: needs exactly one of "action" or "items"`);
      if (hasAction && !parseAction(it.action)) errors.push(`${here}: action "${it.action}" is not one of ${ACTION_KINDS.join(', ')}`);
      if (hasItems) validateItems(it.items, here, errors);
    });
  }

  // Returns { ok, errors } - errors are plain sentences for the tray message.
  function validateMenu(menu) {
    const errors = [];
    if (!menu || !Array.isArray(menu.categories) || menu.categories.length === 0) {
      return { ok: false, errors: ['the file needs a non-empty "categories" list'] };
    }
    menu.categories.forEach((c, n) => {
      const where = c && c.name ? c.name : `category #${n + 1}`;
      if (typeof c.name !== 'string' || !c.name.trim()) errors.push(`${where}: needs a "name"`);
      if (c.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(c.color)) errors.push(`${where}: color must look like #7aa2ff`);
      if (c.apps !== undefined && !Array.isArray(c.apps)) errors.push(`${where}: "apps" must be a list of program names`);
      validateItems(c.items, where, errors);
    });
    return { ok: errors.length === 0, errors };
  }

  // Which ring opens first: the first category that lists the program in
  // front (e.g. "Nuance.PowerScribe360.exe"), otherwise the first one.
  function categoryForApp(menu, exe) {
    if (exe) {
      const want = String(exe).toLowerCase();
      const i = menu.categories.findIndex((c) => (c.apps || []).some((a) => String(a).toLowerCase() === want));
      if (i >= 0) return i;
    }
    return 0;
  }

  return { parseAction, validateMenu, categoryForApp, MAX_ITEMS, ACTION_KINDS };
});
