// "Export library": the Reference Library as an ordinary folder, for a backup
// or to hand to a colleague. One folder per section (a subfolder per topic),
// each picture and file under its title, each note as Markdown, each link as
// a Windows internet shortcut (.url). Nothing in RadGesture's own folder
// changes.

const fs = require('fs');
const path = require('path');

const safe = (t) => String(t || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '') || 'Untitled';

// lib: reflib.read() of the Reference Library ring; refs: the references store.
// Returns { dir, files }.
function exportLibrary(lib, refs, destParent, { unplaced = [] } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  let dir = path.join(destParent, `RadGesture Reference Library ${stamp}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(destParent, `RadGesture Reference Library ${stamp} (${n})`);
  let files = 0;
  const used = new Set();
  const unique = (folder, name, ext) => {
    let f = path.join(folder, name + ext);
    for (let n = 2; used.has(f.toLowerCase()); n++) f = path.join(folder, `${name} (${n})${ext}`);
    used.add(f.toLowerCase());
    return f;
  };
  const write = (folder, it) => {
    fs.mkdirSync(folder, { recursive: true });
    const action = String(it.action || '');
    if (action.startsWith('url:')) {
      fs.writeFileSync(unique(folder, safe(it.name), '.url'), `[InternetShortcut]\r\nURL=${action.slice(4)}\r\n`);
      return files++;
    }
    if (action.startsWith('file:')) {
      // A document of yours elsewhere: a shortcut to where it is.
      fs.writeFileSync(unique(folder, safe(it.name), '.txt'), `This entry opens a file on your PC:\r\n${action.slice(5)}\r\n`);
      return files++;
    }
    const m = /^ref:(r[a-z0-9]+)$/.exec(action);
    const r = m && refs.get(m[1]);
    if (!r) return;
    const title = safe(r.title || it.name);
    const src = r.file ? refs.filePath(r.id) : r.image ? refs.imagePath(r.id) : '';
    if (src && fs.existsSync(src)) {
      fs.copyFileSync(src, unique(folder, title, path.extname(src)));
      files++;
    }
    if (r.body && r.body.trim()) {
      fs.writeFileSync(unique(folder, title + (src ? ' (note)' : ''), '.md'), r.body);
      files++;
    }
  };
  fs.mkdirSync(dir, { recursive: true });
  lib.sections.forEach((s, i) => {
    const folder = path.join(dir, `${String(i + 1).padStart(2, '0')} ${safe(s.name)}`);
    fs.mkdirSync(folder, { recursive: true });
    for (const it of s.items) {
      if (it.topic) it.items.forEach((x) => write(path.join(folder, safe(it.name)), x));
      else write(folder, it);
    }
  });
  for (const it of lib.loose || []) write(path.join(dir, 'On the ring'), it);
  for (const r of unplaced) write(path.join(dir, 'Not in a section'), { name: r.title, action: 'ref:' + r.id });
  return { dir, files };
}

module.exports = { exportLibrary, safe };
