// Builds one self-contained HTML page of the ring for trying in a browser
// (phone, Mac, anything). Same ring code as the app, plus demo.js.
//   node scripts/build-preview.js  ->  dist-preview/RadGesture-preview.html

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const menu = JSON.parse(read('config/default-menu.json'));
// The scripted flows in preview.js drive the AI Tools ring, so the preview
// opens on it (the shipped menu starts on PACS).
const aiAt = menu.categories.findIndex((c) => c.id === 'ai');
if (aiAt > 0) menu.categories.unshift(menu.categories.splice(aiAt, 1)[0]);
const js = ['src/common/menu.js', 'src/common/themes.js', 'src/renderer/geometry.js', 'src/renderer/icons.js', 'src/renderer/ring.js', 'src/renderer/demo.js']
  .map((p) => `/* ${p} */\n${read(p)}`)
  .join('\n');

// The icon font goes in as a data URI so the page works as a single file.
const fontB64 = fs.readFileSync(path.join(root, 'assets/fonts/material-symbols-rounded.woff2')).toString('base64');
const css = read('src/renderer/ring.css').replace("url('../../assets/fonts/material-symbols-rounded.woff2')", `url(data:font/woff2;base64,${fontB64})`);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>RadGesture Preview</title>
<style>
${css}
/* ---- preview page only ---- */
html, body { background: #07090c; touch-action: none; }
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 30% 38% at 58% 52%, rgba(160,165,175,.22), transparent 70%),
    radial-gradient(ellipse 14% 20% at 50% 46%, rgba(210,214,222,.16), transparent 70%),
    radial-gradient(ellipse 60% 70% at 55% 50%, rgba(70,74,82,.28), transparent 75%),
    #07090c;
}
.card {
  position: fixed; left: 16px; top: 16px; max-width: 330px; z-index: 5;
  background: rgba(20,23,30,.88); border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; padding: 14px 16px; box-shadow: 0 12px 30px rgba(0,0,0,.4);
  font-size: 13px; line-height: 1.5; color: rgba(232,236,244,.85);
  transition: opacity .2s ease;
}
.card h1 { margin: 0 0 6px; font-size: 15px; color: #e8ecf4; }
.card kbd { background: #262b35; border-radius: 5px; padding: 1px 6px; font: inherit; font-size: 12px; }
.card ul { margin: 6px 0 0; padding-left: 18px; }
body.ring-open .card { opacity: .25; }
#toast {
  position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 20px); z-index: 6;
  background: rgba(20,23,30,.94); border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
  padding: 10px 16px; font-size: 14px; color: #e8ecf4; opacity: 0; transition: all .22s ease;
  display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; max-width: calc(100% - 32px);
}
#toast span { font-size: 12px; color: rgba(232,236,244,.6); }
#toast.show { opacity: 1; transform: translate(-50%, 0); }
@media (max-width: 520px) { .card { right: 16px; max-width: none; font-size: 12px; } }
</style>
</head>
<body>
<div class="card">
  <h1>RadGesture ring - preview</h1>
  On the workstation you hold <kbd>Ctrl</kbd>+<kbd>CapsLock</kbd>. Here:
  <ul>
    <li><b>Hold</b> the mouse button (or <kbd>Space</kbd>, or a finger) anywhere, <b>flick</b> toward a tool, let go.</li>
    <li><b>Tap</b> instead and the ring stays open: click a tool.</li>
    <li>Flick past <b>One-liner</b>, <b>Prior checklist</b> or a Reference Library section to open its smaller ring.</li>
    <li>Switch rings with the <b>buttons under the ring</b> (one click; the gear at the end opens Settings), or <b>scroll</b>, or click the center (right-click: back one).</li>
    <li><b>Drag the center</b> to move the ring out of the way.</li>
  </ul>
</div>
<div id="stage"></div>
<div id="toast"></div>
<script>window.RG_DEMO_MENU = ${JSON.stringify(menu)};</script>
<script>
${js}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'dist-preview'), { recursive: true });
const out = path.join(root, 'dist-preview', 'RadGesture-preview.html');
fs.writeFileSync(out, page);
console.log('wrote', out, Math.round(page.length / 1024) + ' KB');

// Same page as body content only, for publishing as a claude.ai artifact
// (the host adds its own document skeleton).
const art = page
  .replace(/^<!doctype html>\n<html lang="en">\n<head>\n/, '')
  .replace('<meta charset="utf-8">\n', '')
  .replace(/<meta name="viewport"[^>]*>\n/, '')
  .replace('<title>RadGesture Preview</title>', '<title>RadGesture Ring</title>')
  .replace('</head>\n<body>\n', '')
  .replace('</body>\n</html>\n', '')
  .replace('/* ---- preview page only ---- */', '/* ---- preview page only ---- */\n:root { color-scheme: dark; }')
  .replace('position: fixed; left: 16px; top: 16px;', 'position: fixed; left: max(16px, env(safe-area-inset-left, 0px)); top: calc(16px + env(safe-area-inset-top, 0px));');
fs.writeFileSync(path.join(root, 'dist-preview', 'radgesture-ring.html'), art);
