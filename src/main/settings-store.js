// Everything the Settings window shows and saves, in one place.
//
//  - the rings:        %APPDATA%\RadGesture\menu.json (created from the default)
//  - AI + shortcuts:   %APPDATA%\RadGesture\RadGesture.ini, the file the helper
//                      reads; after a save the hub tells the helper to reload
//  - the library:      config/library.json (the functions and their defaults)
//                      -> RadGesture.ini [Lib.<id>] (what the person chose)
//
// Nobody edits either file by hand; the Settings window does.

const fs = require('fs');
const path = require('path');
const ini = require('./ini');
const { validateMenu } = require('../common/menu');
const { cleanKey } = require('../common/apikey');

// Offered in Settings > AI tools. A saved model not in this list (a retired
// one) reads back as Sonnet 5.5; the helper does the same (NormalizeModel).
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const MODEL_LABELS = {
  'claude-sonnet-5-5': 'Sonnet 5.5 (recommended)',
  'claude-haiku-5-5': 'Haiku 5.5 (fastest, cheapest)',
  'claude-opus-5-5': 'Opus 5.5 (most careful, slower)',
};

// INI field <-> settings field, with the helper's own defaults.
const AI_FIELDS = {
  apiKey: ['API', 'ApiKey', ''],
  model: ['API', 'Model', 'claude-sonnet-5-5'],
  sensitivity: ['Behavior', 'Sensitivity', 'moderate'],
  impressionRules: ['Impression', 'ExtraRules', 'Keep it very short. No measurements or other numbers.'],
  impressionModel: ['Impression', 'Model', ''],
  styleLearn: ['Impression', 'LearnStyle', '1'],
  styleUse: ['Impression', 'UseStyle', '1'],
  priorExpireMinutes: ['Priors', 'ExpireMinutes', '30'],
  priorCapture: ['Priors', 'CaptureMode', 'clipboard'],
  toolbarAtStartup: ['Priors', 'ShowAtStartup', '1'],
};
const SHORTCUT_FIELDS = {
  trigger: ['Hub', 'Trigger', '^CapsLock'],
  proofread: ['Behavior', 'Hotkey', '^!q'],
  oneliner: ['OneLiner', 'Hotkey', '^!u'],
  chartAdd: ['OneLiner', 'ChartAddHotkey', ''],
  impression: ['Impression', 'Hotkey', ''],
  priorAdd: ['Priors', 'AddHotkey', ''],
  priorChecklist: ['Priors', 'ChecklistHotkey', ''],
};

// The function collection (built into the helper).
// Defaults come from config/library.json; what a person changes lives in
// RadGesture.ini [Lib.<id>]: On (keyboard shortcut on), Hotkey, and each
// param (Key = what it presses in Sectra/PowerScribe, Tab, Enter, Urls).
// Target says which program a "bring it up and press Key" function uses; it
// is not a setting, so it is always rewritten from the JSON. The username is
// [Library] Username. The password is never stored (the helper asks for it).
const LIB_SECTION = (id) => 'Lib.' + id;
// Functions that earlier builds shipped off (migrateIni turns them on once).
const FUNCTIONS_NOW_ON = ['PS_ToggleDictation', 'PS_PasteIndication', 'LoginUandP', 'LoginU', 'LoginP', 'LoginForget'];
const M_MAX = 8; // directions per ring (menu.js MAX_ITEMS)
function libraryDefaults(lib) {
  const out = {};
  for (const f of lib.functions) {
    const v = { On: f.on ? '1' : '0', Hotkey: f.hotkey || '' };
    for (const p of f.params || []) v[p.name] = p.default;
    out[f.id] = v;
  }
  return out;
}
// Fills in what is missing, so the helper always finds every value. Returns
// whether the file changed.
function syncLibraryIni(s, lib) {
  let changed = false;
  const defs = libraryDefaults(lib);
  for (const f of lib.functions) {
    const sec = LIB_SECTION(f.id);
    for (const [k, v] of Object.entries(defs[f.id])) {
      if (ini.get(s, sec, k, null) === null) {
        ini.set(s, sec, k, v);
        changed = true;
      }
    }
    if (f.target && ini.get(s, sec, 'Target', null) !== f.target) {
      ini.set(s, sec, 'Target', f.target);
      changed = true;
    }
  }
  return changed;
}

// Older rings pressed a shortcut ("helper:keys:^!2") that a separate script
// answered; now that the function is built in, the ring runs it directly
// ("helper:lib:PACS_WL_Lung"). Only a key that is exactly a function's
// default shortcut changes; a key a person chose
// for their own Sectra stays a key press.
function optimizerKeyMap(lib) {
  const m = new Map();
  for (const f of lib.functions) if (f.hotkey) m.set('helper:keys:' + f.hotkey, 'helper:lib:' + f.id);
  return m;
}

// "My functions": library functions a person writes themselves (the Rad
// Optimizer website's personal functions). Each is an AutoHotkey script in
// %APPDATA%\RadGesture\functions\<id>.ahk, run by the AutoHotkey that ships
// in the helper folder as its own process, so a broken one cannot stop the
// helper. Name / description / On / Hotkey live in [Lib.<id>] like a built-in
// one (plus Custom=1); [Library] Custom lists the ids for the helper.
const CUSTOM_ID = /^my[a-z0-9]{3,24}$/;
const CODE_START = '; ---- your code ----';
const CODE_END = '; ---- end of your code ----';
function wrapCustom(f) {
  const clean = (t) => String(t || '').replace(/[\r\n]+/g, ' ');
  return [
    '; RadGesture: one of "My functions". Written by Settings > Functions; edit it there.',
    '; ' + clean(f.name) + (f.description ? ': ' + clean(f.description) : ''),
    '#NoEnv',
    '#NoTrayIcon',
    '#SingleInstance Off',
    'SendMode Input',
    'SetTitleMatchMode, 2',
    CODE_START,
    String(f.code || '').replace(/\r?\n/g, '\r\n').replace(/\s+$/, ''),
    CODE_END,
    '',
  ].join('\r\n');
}
function unwrapCustom(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const a = t.indexOf(CODE_START);
  const b = t.lastIndexOf(CODE_END);
  if (a < 0 || b < a) return t;
  return t.slice(a + CODE_START.length, b).replace(/^\r?\n/, '').replace(/\r?\n$/, '').replace(/\r\n/g, '\n');
}

// One-time changes to a menu saved by an older version. Each runs once
// (recorded in `migrated`), so something the person adds back stays.
function migrate(m, lib) {
  const done = Array.isArray(m.migrated) ? m.migrated : [];
  let changed = false;
  if (!done.includes('orthogonal-in-measure')) {
    // Orthogonal is a measuring tool: it moves from Crosshair to
    // Measure, right after Distance. Only when both are where we shipped them.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const sub = (n) => pacs && (pacs.items || []).find((it) => it.name === n && Array.isArray(it.items));
    const meas = sub('Measure');
    const cross = sub('Crosshair');
    const oi = cross ? cross.items.findIndex((it) => it.action === 'helper:keys:^!o' || it.action === 'helper:lib:PACS_Orthogonal') : -1;
    const di = meas ? meas.items.findIndex((it) => it.name === 'Distance') : -1;
    if (oi >= 0 && di >= 0 && meas.items.length < 8 && cross.items.length > 1) {
      const [o] = cross.items.splice(oi, 1);
      if (o.icon === 'view_in_ar') o.icon = 'square_foot';
      meas.items.splice(di + 1, 0, o);
    }
    done.push('orthogonal-in-measure');
    changed = true;
  }
  if (!done.includes('no-paste-indication')) {
    // Paste indication (Ctrl+Alt+G) works only on a selection made by hand,
    // never from the ring, so the ring no longer has it.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const ps = pacs && (pacs.items || []).find((it) => it.name === 'PowerScribe' && Array.isArray(it.items));
    if (ps && ps.items.length > 1) ps.items = ps.items.filter((it) => !(it.action === 'helper:keys:^!g' && it.name === 'Paste indication'));
    done.push('no-paste-indication');
    changed = true;
  }
  if (lib && !done.includes('library')) {
    // The functions are built in: the PACS and Apps rings run them directly
    // instead of pressing a shortcut for another script to answer.
    const map = optimizerKeyMap(lib);
    const walk = (items) => (items || []).forEach((it) => {
      if (it.items) walk(it.items);
      else if (map.has(it.action)) it.action = map.get(it.action);
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('library');
    changed = true;
  }
  if (!done.includes('chart-bin')) {
    // The one-liner's chart bin: "Add chart text" and "Clear chart" join the
    // One-liner ring (when it has room).
    const ai = m.categories.find((c) => c.id === 'ai');
    const ol = ai && (ai.items || []).find((it) => it.name === 'One-liner' && Array.isArray(it.items));
    if (ol && ol.items.length <= M_MAX - 2 && !ol.items.some((it) => it.action === 'helper:chart:add')) {
      ol.items.push({ name: 'Add chart text', icon: 'playlist_add', action: 'helper:chart:add' });
      ol.items.push({ name: 'Clear chart', icon: 'playlist_remove', action: 'helper:chart:clear' });
    }
    done.push('chart-bin');
    changed = true;
  }
  if (!done.includes('reference-library')) {
    // The ring of reading material is the Reference Library (it was "Gallery"). Only the shipped name changes; a ring the person
    // renamed keeps their name.
    const g = m.categories.find((c) => c.id === 'gallery' && c.name === 'Gallery');
    if (g) g.name = 'Reference Library';
    done.push('reference-library');
    changed = true;
  }
  if (!done.includes('reference-library-title')) {
    // A title: "Reference Library", capital L.
    const g = m.categories.find((c) => c.id === 'gallery' && c.name === 'Reference library');
    if (g) g.name = 'Reference Library';
    done.push('reference-library-title');
    changed = true;
  }
  if (!done.includes('pacs-first')) {
    // PACS is the first ring, then AI Tools.
    const pi = m.categories.findIndex((c) => c.id === 'pacs');
    const ai = m.categories.findIndex((c) => c.id === 'ai');
    if (pi > 0 && ai >= 0 && ai < pi) m.categories.splice(ai, 0, m.categories.splice(pi, 1)[0]);
    done.push('pacs-first');
    changed = true;
  }
  if (!done.includes('no-lung')) {
    // Lung-RADS and Lung screening 2 are no longer built in (they can be
    // added back as one of "My functions"). Their directions go, and a
    // smaller ring left empty goes with them.
    const gone = new Set(['helper:lungrads', 'helper:lib:LungScreening2']);
    const prune = (items) => (items || []).filter((it) => {
      if (gone.has(it.action)) return false;
      if (Array.isArray(it.items)) {
        const had = it.items.length;
        it.items = prune(it.items);
        return !(had && !it.items.length);
      }
      return true;
    });
    m.categories.forEach((c) => { c.items = prune(c.items); });
    done.push('no-lung');
    changed = true;
  }
  if (!done.includes('nav-names')) {
    // Each previous/next pair has its own pair of icons (layouts: skip,
    // key images: fast-forward/rewind, fields: tab), "Link crosshair" is
    // Link priors, and the Prior checklist's buttons say what they do. Only
    // names and icons we shipped change; ones the person chose stay.
    const icons = {
      'helper:lib:PACS_Prev_Layout': 'skip_previous', 'helper:lib:PACS_Next_Layout': 'skip_next',
      'helper:lib:PACS_Prev_Key_Image': 'fast_rewind', 'helper:lib:PACS_Next_Key_Image': 'fast_forward',
      'helper:lib:PS_PrevField': 'keyboard_tab_rtl', 'helper:lib:PS_NextField': 'keyboard_tab',
    };
    const oldIcons = ['arrow_back', 'arrow_forward', 'field', 'text_fields'];
    const names = {
      'helper:lib:PACS_LinkCrosshair': ['Link crosshair', 'Link priors'],
      'helper:prior:checklist': ['Checklist', 'Make checklist'],
      'helper:prior:clear': ['Clear priors', 'Empty the list'],
      'helper:chart:clear': ['Clear chart', 'Empty chart text'],
    };
    const walk = (items) => (items || []).forEach((it) => {
      if (Array.isArray(it.items)) {
        walk(it.items);
        if (it.name === 'Crosshair' && it.items.some((x) => x.action === 'helper:lib:PACS_LinkCrosshair')) it.name = 'Crosshair & link';
        if (it.name === 'Priors' && it.items.some((x) => /^helper:prior:/.test(x.action || ''))) it.name = 'Prior checklist';
        return;
      }
      if (icons[it.action] && oldIcons.includes(it.icon)) it.icon = icons[it.action];
      const n = names[it.action];
      if (n && it.name === n[0]) it.name = n[1];
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('nav-names');
    changed = true;
  }
  if (!done.includes('ai-settings')) {
    // RadGesture's own Settings is the gear on the ring's bottom bar; the AI
    // ring's "Settings" holds only the AI tools' key, model and history.
    const ai = m.categories.find((c) => c.id === 'ai');
    const s = ai && (ai.items || []).find((it) => it.name === 'Settings' && Array.isArray(it.items) && it.items.some((x) => x.action === 'helper:settings'));
    if (s) {
      s.name = 'AI settings';
      for (const it of s.items) {
        if (it.action === 'helper:settings' && it.name === 'AI settings') it.name = 'Key and model';
        if (it.action === 'hub:edit-menu' && it.name === 'Edit this menu') it.name = 'Edit rings';
      }
    }
    done.push('ai-settings');
    changed = true;
  }
  if (!done.includes('layout-grid')) {
    // Sectra's fixed layouts (rows x columns: 2x2, 3x2, 3x3) as a smaller ring
    // "Grid" in PACS > Layout, after Next layout, when that ring has room and
    // none is there yet.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const lay = pacs && (pacs.items || []).find((it) => it.name === 'Layout' && Array.isArray(it.items));
    const has = (items) => (items || []).some((it) => /^helper:lib:PACS_Layout_/.test(it.action || '') || has(it.items));
    if (lay && lay.items.length < M_MAX && !has(lay.items)) {
      const grid = {
        name: 'Grid',
        icon: 'view_comfy',
        items: ['2x2', '3x2', '3x3'].map((k) => {
          const n = k.replace('x', ' × ');
          return { name: n, icon: 'grid:' + k, action: 'helper:lib:PACS_Layout_' + k };
        }),
      };
      const ni = lay.items.findIndex((it) => it.action === 'helper:lib:PACS_Next_Layout');
      lay.items.splice(ni >= 0 ? ni + 1 : lay.items.length, 0, grid);
    }
    done.push('layout-grid');
    changed = true;
  }
  if (!done.includes('layout-grid-three')) {
    // The Grid holds only 2x2, 3x2 and 3x3; one build also had 2x1, 2x3, 3x1.
    const gone = new Set(['2x1', '2x3', '3x1'].map((k) => 'helper:lib:PACS_Layout_' + k));
    const prune = (items) => (items || []).filter((it) => !gone.has(it.action)).map((it) => (Array.isArray(it.items) ? Object.assign(it, { items: prune(it.items) }) : it));
    m.categories.forEach((c) => { c.items = prune(c.items); });
    done.push('layout-grid-three');
    changed = true;
  }
  if (!done.includes('nav-pairs')) {
    // Every previous/next pair shows one matching pair of icons. Rings saved
    // by early builds still had "back" beside "play" (a triangle), which
    // nav-names did not know. A direction is found by the function it runs,
    // the key it presses, or its name; only icons we ever shipped change.
    const pairs = [
      { name: /^previous layout$/i, acts: ['helper:lib:PACS_Prev_Layout', 'helper:keys:^!r'], icon: 'skip_previous' },
      { name: /^next layout$/i, acts: ['helper:lib:PACS_Next_Layout', 'helper:keys:^!t'], icon: 'skip_next' },
      { name: /^previous key image$/i, acts: ['helper:lib:PACS_Prev_Key_Image', 'helper:keys:^!k'], icon: 'fast_rewind' },
      { name: /^next key image$/i, acts: ['helper:lib:PACS_Next_Key_Image', 'helper:keys:^!i'], icon: 'fast_forward' },
      { name: /^previous field$/i, acts: ['helper:lib:PS_PrevField', 'helper:keys:^!v'], icon: 'keyboard_tab_rtl' },
      { name: /^next field$/i, acts: ['helper:lib:PS_NextField', 'helper:keys:^!f'], icon: 'keyboard_tab' },
    ];
    const shipped = ['back', 'play', 'arrow_back', 'arrow_forward', 'play_arrow', 'field', 'text_fields'];
    const walk = (items) => (items || []).forEach((it) => {
      if (Array.isArray(it.items)) return walk(it.items);
      const p = pairs.find((x) => x.acts.includes(it.action) || x.name.test(String(it.name || '').trim()));
      if (p && shipped.includes(it.icon)) it.icon = p.icon;
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('nav-pairs');
    changed = true;
  }
  if (!done.includes('orthogonal-ruler')) {
    // Orthogonal measures two distances at 90 degrees: its icon is the
    // L-shaped ruler, in place of any icon we shipped for it before (a grid,
    // a cube, a set square).
    const walk = (items) => (items || []).forEach((it) => {
      if (Array.isArray(it.items)) return walk(it.items);
      const ortho = it.action === 'helper:lib:PACS_Orthogonal' || it.action === 'helper:keys:!o' || it.action === 'helper:keys:^!o' || /^orthogonal$/i.test(String(it.name || '').trim());
      if (ortho && ['grid', 'grid_view', 'view_in_ar', 'square_foot'].includes(it.icon)) it.icon = 'ti:ruler';
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('orthogonal-ruler');
    changed = true;
  }
  if (!done.includes('openevidence-search')) {
    // "Search copied text" can ask OpenEvidence too, when its ring has room.
    const walk = (items) => (items || []).forEach((it) => {
      if (!Array.isArray(it.items)) return;
      const searches = it.items.length && it.items.every((x) => /^search:/.test(x.action || ''));
      if (searches && it.items.length < M_MAX && !it.items.some((x) => x.action === 'helper:oe:clip')) {
        it.items.push({ name: 'OpenEvidence', icon: 'clinical_notes', action: 'helper:oe:clip' });
      }
      walk(it.items);
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('openevidence-search');
    changed = true;
  }
  if (!done.includes('pacs-no-fields')) {
    // Previous / Next field are PowerScribe keys, not PACS tools: they leave
    // the PACS ring and keep working from their shortcuts. Anything else the
    // person put in that smaller ring stays.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const field = (it) => ['helper:lib:PS_PrevField', 'helper:lib:PS_NextField', 'helper:keys:^!v', 'helper:keys:^!f'].includes(it.action) ||
      /^(previous|next) field$/i.test(String(it.name || '').trim());
    if (pacs) {
      pacs.items = (pacs.items || []).filter((it) => {
        if (!(it.name === 'PowerScribe' && Array.isArray(it.items))) return true;
        it.items = it.items.filter((x) => !field(x));
        return it.items.length > 0;
      });
    }
    done.push('pacs-no-fields');
    changed = true;
  }
  if (!done.includes('organ-icons')) {
    // Window / level presets show their organ (stomach, bone, brain), and
    // the oncologic one-liner the cancer ribbon. Only icons we shipped change.
    const icons = [
      { acts: ['helper:lib:PACS_WL_SoftTissue'], name: /^soft tissue$/i, from: ['contrast'], icon: 'gastroenterology' },
      { acts: ['helper:lib:PACS_WL_Bone'], name: /^bone$/i, from: ['skeleton'], icon: 'ti:bone' },
      { acts: ['helper:lib:PACS_WL_Brain'], name: /^brain$/i, from: ['neurology'], icon: 'ti:brain' },
      { acts: ['helper:lib:PACS_WL_Stroke'], name: /^stroke$/i, from: ['emergency'], icon: 'ti:brain' },
      { acts: ['helper:oneliner:oncologic'], name: /^oncologic$/i, from: ['oncology', 'target'], icon: 'ti:ribbon-health' },
    ];
    const walk = (items) => (items || []).forEach((it) => {
      if (Array.isArray(it.items)) return walk(it.items);
      const k = icons.find((x) => x.acts.includes(it.action) || (x.name.test(String(it.name || '').trim()) && /^helper:/.test(it.action || '')));
      if (k && k.from.includes(it.icon)) it.icon = k.icon;
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('organ-icons');
    changed = true;
  }
  if (!done.includes('pacs-image')) {
    // Image manipulations get their own smaller ring, "Image" (the Enhance
    // ring renamed): MPR (moved from Layout), Thick slab, Slab off, Invert,
    // Enhance, Sharpen, Reset. Pinpoint joins Crosshair & link, Show report
    // the PACS ring. Each only where there is room and it is not there yet.
    const pacs = m.categories.find((c) => c.id === 'pacs');
    const lib = (id) => 'helper:lib:' + id;
    const fn = (id, name, icon) => ({ name, icon, action: lib(id) });
    const has = (items, a) => (items || []).some((it) => it.action === a || (Array.isArray(it.items) && has(it.items, a)));
    const ringWith = (a) => pacs && (pacs.items || []).find((it) => Array.isArray(it.items) && it.items.some((x) => x.action === a));
    if (pacs) {
      let img = ringWith(lib('PACS_Enhance')) || ringWith(lib('PACS_Sharpen'));
      if (!img && pacs.items.length < M_MAX) {
        img = { name: 'Image', icon: 'tune', items: [] };
        pacs.items.push(img);
      }
      if (img) {
        if (img.name === 'Enhance') { img.name = 'Image'; if (img.icon === 'wand_stars') img.icon = 'tune'; }
        // MPR moves in from wherever it is (Layout, as shipped).
        let mpr = null;
        if (!img.items.some((x) => x.action === lib('PACS_MPR'))) {
          for (const r of pacs.items) {
            if (!Array.isArray(r.items) || r === img) continue;
            const k = r.items.findIndex((x) => x.action === lib('PACS_MPR'));
            if (k >= 0 && r.items.length > 1) { mpr = r.items.splice(k, 1)[0]; break; }
          }
        }
        const front = [mpr, fn('PACS_Thick_Slab', 'Thick slab', 'ti:stack-2'), fn('PACS_Slab_Off', 'Slab off', 'ti:minus'), fn('PACS_Invert', 'Invert', 'invert_colors')]
          .filter((x) => x && !has(pacs.items, x.action));
        img.items.splice(0, 0, ...front.slice(0, Math.max(0, M_MAX - img.items.length)));
        if (!has(pacs.items, lib('PACS_Reset')) && img.items.length < M_MAX) img.items.push(fn('PACS_Reset', 'Reset', 'restart_alt'));
      }
      const cross = ringWith(lib('PACS_Crosshair'));
      if (cross && cross.items.length < M_MAX && !has(pacs.items, lib('PACS_Pinpoint'))) cross.items.push(fn('PACS_Pinpoint', 'Pinpoint', 'ti:focus-2'));
      if (pacs.items.length < M_MAX && !has(pacs.items, lib('PACS_Show_Report'))) pacs.items.push(fn('PACS_Show_Report', 'Show report', 'description'));
    }
    done.push('pacs-image');
    changed = true;
  }
  if (!done.includes('keep-open-nav')) {
    // Previous / next are pressed again and again: the ring stays open after
    // them (the "Keep the ring open" switch on each direction).
    const nav = ['PACS_Prev_Layout', 'PACS_Next_Layout', 'PACS_Prev_Key_Image', 'PACS_Next_Key_Image'].map((id) => 'helper:lib:' + id)
      .concat(['helper:keys:^!r', 'helper:keys:^!t', 'helper:keys:^!k', 'helper:keys:^!i']);
    const walk = (items) => (items || []).forEach((it) => {
      if (Array.isArray(it.items)) return walk(it.items);
      if (nav.includes(it.action) && it.stay === undefined) it.stay = true;
    });
    m.categories.forEach((c) => walk(c.items));
    done.push('keep-open-nav');
    changed = true;
  }
  if (!done.includes('impression-style')) {
    // "Learn this impression" goes right after Impression on the AI Tools
    // ring, when there is room and it is not there yet.
    const ai = m.categories.find((c) => c.id === 'ai');
    const has = (items) => (items || []).some((it) => it.action === 'helper:style:learn' || (Array.isArray(it.items) && has(it.items)));
    if (ai && !has(ai.items) && (ai.items || []).length < M_MAX) {
      const i = ai.items.findIndex((it) => it.action === 'helper:impression');
      ai.items.splice(i >= 0 ? i + 1 : ai.items.length, 0, { name: 'Learn this impression', icon: 'school', action: 'helper:style:learn' });
    }
    done.push('impression-style');
    changed = true;
  }
  if (changed) m.migrated = done;
  return changed;
}

function createStore({ userDir, defaultMenuPath, libraryPath }) {
  const menuPath = () => path.join(userDir(), 'menu.json');
  const iniPath = () => path.join(userDir(), 'RadGesture.ini');
  const defaultMenu = () => JSON.parse(fs.readFileSync(defaultMenuPath, 'utf8'));
  const library = () => (libraryPath ? JSON.parse(fs.readFileSync(libraryPath, 'utf8')) : null);

  function readMenu() {
    if (!fs.existsSync(menuPath())) {
      fs.mkdirSync(userDir(), { recursive: true });
      fs.writeFileSync(menuPath(), JSON.stringify(defaultMenu(), null, 2));
    }
    const m = JSON.parse(fs.readFileSync(menuPath(), 'utf8'));
    const v = validateMenu(m);
    if (!v.ok) throw new Error(v.errors.slice(0, 3).join('; '));
    if (migrate(m, library())) writeMenu(m);
    return m;
  }

  function writeMenu(m) {
    const v = validateMenu(m);
    if (!v.ok) return { ok: false, errors: v.errors };
    fs.mkdirSync(userDir(), { recursive: true });
    const tmp = menuPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
    fs.renameSync(tmp, menuPath());
    return { ok: true, errors: [] };
  }

  // Every library value the helper reads, written before the helper starts.
  function syncLibrary() {
    const lib = library();
    if (!lib) return false;
    const s = readIni();
    if (!syncLibraryIni(s, lib)) return false;
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
    return true;
  }

  const functionsDir = () => path.join(userDir(), 'functions');
  const customIds = (s) => String(ini.get(s, 'Library', 'Custom', '')).split('|').filter((x) => CUSTOM_ID.test(x));

  // { values: { <id>: { On, Hotkey, Key, ... } }, username, custom: [...] }
  function readLibrary() {
    const lib = library();
    const s = readIni();
    const defs = libraryDefaults(lib);
    const values = {};
    for (const f of lib.functions) {
      values[f.id] = {};
      for (const [k, v] of Object.entries(defs[f.id])) values[f.id][k] = ini.get(s, LIB_SECTION(f.id), k, v);
    }
    const custom = customIds(s).map((id) => {
      const sec = LIB_SECTION(id);
      const file = path.join(functionsDir(), id + '.ahk');
      values[id] = { On: ini.get(s, sec, 'On', '0'), Hotkey: ini.get(s, sec, 'Hotkey', '') };
      return {
        id,
        name: ini.get(s, sec, 'Name', id),
        description: ini.get(s, sec, 'Description', ''),
        code: fs.existsSync(file) ? unwrapCustom(fs.readFileSync(file, 'utf8')) : '',
      };
    });
    return { values, username: ini.get(s, 'Library', 'Username', ''), custom };
  }

  function writeLibrary(v) {
    const lib = library();
    const s = readIni();
    const defs = libraryDefaults(lib);
    for (const f of lib.functions) {
      const mine = (v.values || {})[f.id] || {};
      for (const k of Object.keys(defs[f.id])) if (mine[k] !== undefined) ini.set(s, LIB_SECTION(f.id), k, String(mine[k]));
    }
    if (v.username !== undefined) ini.set(s, 'Library', 'Username', String(v.username).trim());
    if (Array.isArray(v.custom)) {
      const keep = v.custom.filter((f) => f && CUSTOM_ID.test(f.id));
      for (const old of customIds(s)) {
        if (keep.some((f) => f.id === old)) continue;
        s.delete(LIB_SECTION(old));
        fs.rmSync(path.join(functionsDir(), old + '.ahk'), { force: true });
      }
      fs.mkdirSync(functionsDir(), { recursive: true });
      for (const f of keep) {
        const sec = LIB_SECTION(f.id);
        const mine = (v.values || {})[f.id] || {};
        ini.set(s, sec, 'Custom', '1');
        ini.set(s, sec, 'Name', String(f.name || 'My function').trim() || 'My function');
        ini.set(s, sec, 'Description', String(f.description || '').trim());
        ini.set(s, sec, 'On', mine.On === '1' ? '1' : '0');
        ini.set(s, sec, 'Hotkey', String(mine.Hotkey || ''));
        // UTF-8 with a BOM: how AutoHotkey v1 knows the file is UTF-8.
        fs.writeFileSync(path.join(functionsDir(), f.id + '.ahk'), '\uFEFF' + wrapCustom(f), 'utf8');
      }
      ini.set(s, 'Library', 'Custom', keep.map((f) => f.id).join('|'));
    }
    syncLibraryIni(s, lib);
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
  }

  // One-time changes to an older RadGesture.ini (recorded in [RadGesture]
  // Migrated). Runs before the helper starts, so it reads the result.
  function migrateIni() {
    if (!fs.existsSync(iniPath())) return false;
    const s = readIni();
    const done = String(ini.get(s, 'RadGesture', 'Migrated', '')).split(',').filter(Boolean);
    let changed = false;
    if (!done.includes('prior-toolbar')) {
      // Some earlier builds hid the floating Priors toolbar by default and
      // saved that; show it again once.
      ini.set(s, 'Priors', 'ShowAtStartup', '1');
      done.push('prior-toolbar');
      changed = true;
    }
    if (!done.includes('functions-on')) {
      // Every built-in function now ships with its shortcut on; earlier
      // builds saved some of them off.
      for (const id of FUNCTIONS_NOW_ON) if (ini.get(s, LIB_SECTION(id), 'On', null) !== null) ini.set(s, LIB_SECTION(id), 'On', '1');
      done.push('functions-on');
      changed = true;
    }
    if (!changed) return false;
    ini.set(s, 'RadGesture', 'Migrated', done.join(','));
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
    return true;
  }

  function readIni() {
    return ini.parse(fs.existsSync(iniPath()) ? fs.readFileSync(iniPath(), 'latin1') : '');
  }

  function readFields(fields) {
    const s = readIni();
    const out = {};
    for (const [k, [sec, key, dflt]] of Object.entries(fields)) out[k] = ini.get(s, sec, key, dflt);
    return out;
  }

  function writeFields(fields, values) {
    const s = readIni();
    for (const [k, [sec, key]] of Object.entries(fields)) {
      if (values[k] !== undefined) ini.set(s, sec, key, values[k]);
    }
    fs.mkdirSync(userDir(), { recursive: true });
    fs.writeFileSync(iniPath(), ini.serialize(s), 'latin1');
  }

  return {
    menuPath,
    iniPath,
    defaultMenu,
    library,
    readMenu,
    syncLibrary,
    readLibrary,
    writeLibrary,
    migrateIni,
    writeMenu,
    readAI: () => {
      const v = readFields(AI_FIELDS);
      if (!MODELS.includes(v.model)) v.model = MODELS[0];
      v.apiKey = cleanKey(v.apiKey);
      return v;
    },
    writeAI: (v) => writeFields(AI_FIELDS, { ...v, ...(v.apiKey !== undefined ? { apiKey: cleanKey(v.apiKey) } : {}) }),
    readShortcuts: () => readFields(SHORTCUT_FIELDS),
    writeShortcuts: (v) => writeFields(SHORTCUT_FIELDS, v),
  };
}

module.exports = { createStore, MODELS, MODEL_LABELS, AI_FIELDS, SHORTCUT_FIELDS, migrate, libraryDefaults, syncLibraryIni, optimizerKeyMap, wrapCustom, unwrapCustom, CUSTOM_ID };
