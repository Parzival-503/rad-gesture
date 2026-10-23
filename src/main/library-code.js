// The AutoHotkey code behind each library function, for Settings > Functions
// ("Show the code"), the way the Rad Optimizer website showed each module.
// Read from the helper script itself, so what is shown is what runs.

// A "bring it up and press Key" function has no code of its own: show the
// two lines it amounts to, as Rad Optimizer had them.
function pressSnippet(f, key) {
  const win = f.target === 'powerscribe' ? 'ahk_exe Nuance.PowerScribe360.exe' : 'Image Window';
  return `${f.id}()\n{\n    WinActivate, ${win}\n    Send, ${key || '(no key set)'}\n}\n\n; (runs as LibPress: says so when the program is not open, instead of\n; pressing the key into the window in front)`;
}

// The function named `name` in `src`, from its line to its closing brace,
// with the comment block above it.
function functionSource(src, name) {
  const lines = String(src).split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(name + '('));
  if (start < 0) return '';
  let from = start;
  while (from > 0 && lines[from - 1].startsWith(';')) from--;
  let depth = 0, seen = false;
  for (let i = start; i < lines.length; i++) {
    const code = lines[i].replace(/\s;.*$/, '').replace(/"(?:[^"]|"")*"/g, '""');
    for (const ch of code) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth === 0) return lines.slice(from, i + 1).join('\n');
  }
  return '';
}

// Which helper functions make up a library function (the first is its own).
const CODE_FUNCS = {
  PS_ToggleDictation: ['Lib_ToggleDictation'],
  PS_PasteIndication: ['Lib_PasteIndication'],
  LungScreening2: ['Lib_LungScreening2', 'Lib_FindPickListControl_Fast', 'Lib_DoubleClickIndex'],
  PACS_Insert_Priors: ['Lib_InsertPriors'],
  LoginUandP: ['Lib_Login', 'LibPassword'],
  LoginU: ['Lib_Login'],
  LoginP: ['Lib_Login', 'LibPassword'],
  LoginForget: ['LibRun'],
  ActivateEPIC: ['Lib_ActivateEPIC'],
  ActivateTeams: ['Lib_ActivateTeams'],
  OpenChromeTabs: ['Lib_OpenTabs'],
  SearchRadiopaediaGoogle: ['Lib_SearchRadiopaediaGoogle'],
};

function codeFor(lib, src, values = {}) {
  const out = {};
  for (const f of lib.functions) {
    const dflt = ((f.params || []).find((p) => p.name === 'Key') || {}).default;
    if (f.target) out[f.id] = pressSnippet(f, (values[f.id] || {}).Key || dflt);
    else out[f.id] = (CODE_FUNCS[f.id] || []).map((n) => functionSource(src, n)).filter(Boolean).join('\n\n');
  }
  return out;
}

module.exports = { codeFor, functionSource, pressSnippet, CODE_FUNCS };
