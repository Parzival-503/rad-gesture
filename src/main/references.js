// The Reference Library's own entries: notes (Markdown), pictures
// (screenshots) and files (an article as PDF, a slide deck...), kept on this
// PC in %APPDATA%\RadGesture\references\:
//   index.json        [{ id, title, tags, image, file, fileName, created, updated }]
//   <id>.md           the note (also the caption under a picture or file)
//   <id>.png          the picture, if any
//   <id>.<ext>        a copy of the file, if any (so it opens even after the
//                     original is moved or deleted)
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
  function filePath(id) {
    const r = get(id);
    return r && r.file ? path.join(root(), r.file) : '';
  }

  // A copy of a file on this PC becomes an entry; titled by its file name.
  function addFile(src, { title, tags } = {}) {
    const ext = (path.extname(src).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
    const r = save({ title: title || path.basename(src, path.extname(src)), tags, body: '' });
    const all = readIndex();
    const e = all.find((x) => x.id === r.id);
    e.file = r.id + ext;
    e.fileName = path.basename(src).slice(0, 200);
    fs.copyFileSync(src, path.join(root(), e.file));
    writeIndex(all);
    return get(r.id);
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
    for (const f of [r.id + '.md', r.image, r.file].filter(Boolean)) fs.rmSync(path.join(root(), f), { force: true });
    return true;
  }

  return { list, get, save, remove, imagePath, filePath, addFile, ID };
}

module.exports = { createReferences, ID };
