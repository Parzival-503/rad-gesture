// Before packaging: copy the helper functions that Settings > Functions
// shows under "Code" into config/library-code.txt, which ships inside the
// app. The installed app has only the compiled helper, not its script.
const fs = require('fs');
const path = require('path');
const { extractCode } = require('../src/main/library-code');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'helper', 'RadGestureHelper.ahk'), 'utf8');
const out = path.join(root, 'config', 'library-code.txt');
fs.writeFileSync(out, extractCode(src));
console.log('wrote', path.relative(root, out));
