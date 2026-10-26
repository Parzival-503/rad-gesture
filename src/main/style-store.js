// Where the radiologist's impression examples live:
// %APPDATA%\RadGesture\style\examples.json, on this PC only.
// The logic (reading reports, blanking dates and numbers, choosing the
// closest examples) is in src/common/impstyle.js.

const fs = require('fs');
const path = require('path');
const S = require('../common/impstyle');

function createStyleStore({ userDir }) {
  const dir = () => path.join(userDir(), 'style');
  const file = () => path.join(dir(), 'examples.json');

  function list() {
    try {
      const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
      return Array.isArray(d.examples) ? d.examples : [];
    } catch (_) {
      return [];
    }
  }
  function save(examples) {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, examples }, null, 1));
    fs.renameSync(tmp, file());
  }

  // One finished report -> { saved: true, example, count } | { skip: why }.
  function learn(report, opts = {}) {
    const ex = S.fromReport(report, opts);
    if (ex.skip) return ex;
    const all = S.add(list(), ex);
    save(all);
    return { saved: true, example: ex, count: all.length };
  }

  // Many reports pasted at once -> { added, skipped }.
  function importText(text) {
    let all = list();
    let added = 0, skipped = 0;
    for (const r of S.splitMany(text)) {
      const ex = S.fromReport(r, { source: 'import' });
      if (ex.skip) { skipped++; continue; }
      all = S.add(all, ex);
      added++;
    }
    if (added) save(all);
    return { added, skipped, count: all.length };
  }

  function remove(id) {
    save(list().filter((x) => x.id !== id));
  }
  function clear() {
    save([]);
  }
  // The prompt block for a report about to get an impression ('' when none).
  function promptFor(report) {
    return S.promptBlock(S.pick(list(), report));
  }

  return { file, list, learn, importText, remove, clear, promptFor };
}

module.exports = { createStyleStore };
