// The Reference Library's own entries: notes (Markdown) and pictures
// (screenshots), kept on this PC in %APPDATA%\RadGesture\references\:
//   index.json        [{ id, title, tags, image, created, updated }]
//   <id>.md           the note (also the caption under a picture)
//   <id>.png          the picture, if any
// Settings > References edits them; the ring opens one with "ref:<id>" in the
// reference viewer window. Kept free of Electron (pictures arrive as PNG
// bytes) so it can be tested.

const fs = require('fs');
const path = require('path');

const ID = /^r[a-z0-9]{4,24}$/;
const MAX_TITLE = 120;

function createReferences({ dir }) {
  const root = () => dir();
  const indexPath = () => path.join(root(), 'index.json');
  const newId = () => 'r' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);

  function readIndex() {
    try {
      const list = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
      return Array.isArray(list) ? list.filter((r) => r && ID.test(r.id)) : [];
    } catch (_) {
      return [];
    }
  }
  function writeIndex(list) {
    fs.mkdirSync(root(), { recursive: true });
    const tmp = indexPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, indexPath());
  }
  const cleanTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(','))
    .map((x) => String(x).trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 12);

  // Everything for the list: entries with their note text (for search).
  function list() {
    return readIndex().map((r) => ({ ...r, body: body(r.id) })).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  function body(id) {
    try { return fs.readFileSync(path.join(root(), id + '.md'), 'utf8'); } catch (_) { return ''; }
  }
  function get(id) {
    if (!ID.test(String(id))) return null;
    const r = readIndex().find((x) => x.id === id);
    return r ? { ...r, body: body(id) } : null;
  }
  function imagePath(id) {
    const r = get(id);
    return r && r.image ? path.join(root(), r.image) : '';
  }

  // Creates (no id) or updates an entry. `png`: Buffer of a PNG to store.
  function save({ id, title, tags, body: text, png }) {
    const all = readIndex();
    let r = id ? all.find((x) => x.id === id) : null;
    const now = Date.now();
    if (!r) {
      r = { id: newId(), title: '', tags: [], image: '', created: now, updated: now };
      all.push(r);
    }
    if (title !== undefined) r.title = String(title).replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TITLE);
    if (tags !== undefined) r.tags = cleanTags(tags);
    fs.mkdirSync(root(), { recursive: true });
    if (text !== undefined) fs.writeFileSync(path.join(root(), r.id + '.md'), String(text));
    if (png) {
      r.image = r.id + '.png';
      fs.writeFileSync(path.join(root(), r.image), png);
    }
    if (!r.title) r.title = r.image ? 'Screenshot ' + new Date(r.created).toLocaleDateString() : 'Untitled note';
    r.updated = now;
    writeIndex(all);
    return get(r.id);
  }

  function remove(id) {
    const all = readIndex();
    const r = all.find((x) => x.id === id);
    if (!r) return false;
    writeIndex(all.filter((x) => x.id !== id));
    for (const f of [r.id + '.md', r.image].filter(Boolean)) fs.rmSync(path.join(root(), f), { force: true });
    return true;
  }

  return { list, get, save, remove, imagePath, ID };
}

module.exports = { createReferences, ID };
