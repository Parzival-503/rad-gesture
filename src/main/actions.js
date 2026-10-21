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

// "Open a program" for the helper: "run:<mode>|<path>|<options>".
//   mode  front = start it, or bring its window up if it is already open
//         new   = always start another copy
//         start = start it only if it is not running (RadGesture starting up)
function runSpec(item, mode, env = {}) {
  const a = parseAction(item.action);
  const m = mode || (item.ifRunning === 'new' ? 'new' : 'front');
  return `run:${m}|${expandEnv(a ? a.value : '', env)}|${String(item.args || '').replace(/[\r\n]+/g, ' ')}`;
}

// Returns what to do; the caller decides how (the helper gets "helper" ids).
function resolveAction(action, { env = {}, clipboard = '' } = {}) {
  const a = parseAction(action);
  if (!a) return { kind: 'invalid', value: String(action) };
  if (a.kind === 'file' || a.kind === 'app') return { kind: a.kind, value: expandEnv(a.value, env) };
  if (a.kind === 'search') return { kind: 'url', value: fillClipboard(a.value, clipboard) };
  return a;
}

module.exports = { resolveAction, runSpec, expandEnv, fillClipboard };
