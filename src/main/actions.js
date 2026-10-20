// Turning an action string into something that happens. Kept free of Electron
// so it can be tested; main.js passes in the Electron functions.

const { parseAction } = require('../common/menu');

function expandEnv(p, env) {
  return p.replace(/%([^%]+)%/g, (m, name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key] : m;
  });
}

// Copied text goes into a search address. Trimmed and capped: a whole report
// pasted into a search box helps nobody.
function fillClipboard(template, clip) {
  const text = String(clip || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return template.split('{clipboard}').join(encodeURIComponent(text));
}

// Returns what to do; the caller decides how (the helper gets "helper" ids).
function resolveAction(action, { env = {}, clipboard = '' } = {}) {
  const a = parseAction(action);
  if (!a) return { kind: 'invalid', value: String(action) };
  if (a.kind === 'file') return { kind: 'file', value: expandEnv(a.value, env) };
  if (a.kind === 'search') return { kind: 'url', value: fillClipboard(a.value, clipboard) };
  return a;
}

module.exports = { resolveAction, expandEnv, fillClipboard };
