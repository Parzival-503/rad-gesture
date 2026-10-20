// Minimal INI reader/writer for the helper's RadGesture.ini, which AutoHotkey
// reads with IniRead (Windows GetPrivateProfileString). Keeps section and key
// order, writes CRLF and plain ASCII so AutoHotkey reads it the same way.

function parse(text) {
  const sections = new Map(); // name -> Map(key -> value)
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const s = line.match(/^\[(.+)\]$/);
    if (s) {
      cur = s[1].trim();
      if (!sections.has(cur)) sections.set(cur, new Map());
      continue;
    }
    const i = line.indexOf('=');
    if (i > 0 && cur) sections.get(cur).set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return sections;
}

// Typographic punctuation to ASCII; anything else outside ASCII is dropped.
function asciiOnly(v) {
  return String(v)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '');
}

function serialize(sections) {
  const out = [];
  for (const [name, keys] of sections) {
    out.push(`[${name}]`);
    for (const [k, v] of keys) out.push(`${k}=${asciiOnly(v)}`);
  }
  return out.join('\r\n') + '\r\n';
}

function get(sections, sec, key, dflt = '') {
  const s = sections.get(sec);
  return s && s.has(key) ? s.get(key) : dflt;
}

function set(sections, sec, key, value) {
  if (!sections.has(sec)) sections.set(sec, new Map());
  sections.get(sec).set(key, String(value));
}

module.exports = { parse, serialize, get, set, asciiOnly };
