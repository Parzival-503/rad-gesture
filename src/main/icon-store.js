// Pictures used as ring icons: ones the user added, and programs' own icons.
// Kept in %APPDATA%\RadGesture\icons (the install folder is replaced on every
// update) and handed to the ring and Settings as data: URLs, so the pages
// never need to read files outside the app. A menu refers to one as
// "img:<file>". Electron's nativeImage is passed in, so this stays testable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_BYTES = 512 * 1024; // an icon, not a photo
const SIZE = 96; // px, plenty for a 58 px direction on a high-DPI screen

function createIconStore({ dir, nativeImage = null }) {
  const ensure = () => fs.mkdirSync(dir(), { recursive: true });
  const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

  function list() {
    try {
      return fs.readdirSync(dir()).filter((f) => TYPES[path.extname(f).toLowerCase()]).sort();
    } catch (_) {
      return [];
    }
  }

  function dataUrl(file) {
    const p = path.join(dir(), path.basename(file));
    try {
      return `data:${TYPES[path.extname(p).toLowerCase()]};base64,${fs.readFileSync(p).toString('base64')}`;
    } catch (_) {
      return null;
    }
  }

  // { file: dataURL } for the given files (or all of them).
  function dataUrls(files = list()) {
    const out = {};
    for (const f of files) {
      const u = dataUrl(f);
      if (u) out[f] = u;
    }
    return out;
  }

  // The "img:" files a menu uses.
  function usedBy(menu) {
    const used = new Set();
    const walk = (items) => (items || []).forEach((it) => {
      if (typeof it.icon === 'string' && it.icon.startsWith('img:')) used.add(it.icon.slice(4));
      if (it.items) walk(it.items);
    });
    (menu.categories || []).forEach((c) => {
      if (typeof c.icon === 'string' && c.icon.startsWith('img:')) used.add(c.icon.slice(4));
      walk(c.items);
    });
    return [...used];
  }

  // Copies a picture in (shrunk to SIZE px when it is a PNG/JPEG/ICO the
  // system can read). Returns { ok, file } or { ok: false, error }.
  function importFile(src) {
    const ext = path.extname(src).toLowerCase();
    if (!TYPES[ext]) return { ok: false, error: 'Use a PNG, JPG, SVG, ICO, WEBP or GIF picture.' };
    let buf = fs.readFileSync(src);
    let outExt = ext;
    if (nativeImage && ['.png', '.jpg', '.jpeg', '.ico'].includes(ext)) {
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const scaled = width > SIZE || height > SIZE ? img.resize(width >= height ? { width: SIZE } : { height: SIZE }) : img;
        buf = scaled.toPNG();
        outExt = '.png';
      }
    }
    if (buf.length > MAX_BYTES) return { ok: false, error: 'That picture is too big for an icon (over 512 KB). Use a smaller one.' };
    ensure();
    const file = hash(buf) + outExt;
    fs.writeFileSync(path.join(dir(), file), buf);
    return { ok: true, file };
  }

  // A program's own icon (a nativeImage from app.getFileIcon).
  function saveProgramIcon(programPath, image) {
    if (!image || image.isEmpty()) return null;
    ensure();
    const file = 'app-' + hash(Buffer.from(String(programPath).toLowerCase())) + '.png';
    fs.writeFileSync(path.join(dir(), file), image.toPNG());
    return file;
  }

  return { list, dataUrl, dataUrls, usedBy, importFile, saveProgramIcon };
}

module.exports = { createIconStore, TYPES };
