// Before packaging: copy the helper functions that Settings > Functions
// shows under "Code" into config/library-code.txt, which ships inside the
// app. The installed app has only the compiled helper, not its script.
const fs = require('fs');
const path = require('path');
const { extractCode } = require('../src/main/library-code');

const root = path.join(__dirname, '..');
const script = path.join(root, 'helper', 'RadGestureHelper.ahk');
const out = path.join(root, 'config', 'library-code.txt');
// CI copies it out before it removes the script from a compiled build.
if (!fs.existsSync(script)) {
  if (fs.existsSync(out)) process.exit(console.log('kept', path.relative(root, out)) || 0);
  console.error('Neither helper/RadGestureHelper.ahk nor config/library-code.txt exists.');
  process.exit(1);
}
const src = fs.readFileSync(script, 'utf8');
fs.writeFileSync(out, extractCode(src));
console.log('wrote', path.relative(root, out));
