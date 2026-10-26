// The radiologist's own impression style, learned from their reports.
//
// Each example is one finished report's FINDINGS and the IMPRESSION the
// radiologist signed (plus the exam line and history, which say what the
// impression had to answer). When Impression runs, the closest few examples
// (same kind of exam first, then the most similar findings) go into the
// prompt, so the impression comes out in the radiologist's own wording,
// length and habits instead of a generic voice.
//
// Before anything is kept, the patient header is dropped (only exam, history,
// findings and impression survive) and dates, long numbers, times and
// signature lines are blanked out.
(function (root) {
  const MAX_EXAMPLES = 600;
  const PICK = 4;
  const BUDGET = 7000; // characters of examples in one prompt

  // ---- reading a report

  const HEAD = (names) => new RegExp('^[ \\t]*(?:' + names + ')[ \\t]*:', 'im');
  const H = {
    exam: HEAD('EXAMINATION|EXAM|PROCEDURE|STUDY'),
    history: HEAD('CLINICAL HISTORY|HISTORY|INDICATION|INDICATIONS|CLINICAL INDICATION|REASON FOR EXAM'),
    findings: HEAD('FINDINGS'),
    impression: HEAD('IMPRESSION|CONCLUSION|CONCLUSIONS'),
  };
  // Anything after these, at the start of a line, is not part of the impression.
  const TAIL = /^[ \t]*(?:electronically signed|signed by|dictated by|transcribed by|attending|i have personally reviewed|report (?:approved|signed|finalized)|this report|workstation|dictated:|signed:|addendum)\b/im;
  // A section ends at the next "WORD WORD:" header on its own line start.
  const NEXT = /^[ \t]*[A-Z][A-Z /&-]{2,40}:/m;

  function section(text, re) {
    const m = re.exec(text);
    if (!m) return '';
    let rest = text.slice(m.index + m[0].length);
    const n = NEXT.exec(rest.replace(/^[^\n]*/, (l) => ' '.repeat(l.length))); // skip the header's own line
    if (n) rest = rest.slice(0, n.index);
    return rest.trim();
  }

  // -> { exam, history, findings, impression } ('' for any part not found).
  function split(report) {
    const t = String(report || '').replace(/\r\n?/g, '\n');
    let impression = '';
    const im = H.impression.exec(t);
    if (im) {
      impression = t.slice(im.index + im[0].length);
      const tail = TAIL.exec(impression);
      if (tail) impression = impression.slice(0, tail.index);
      impression = impression.trim();
    }
    let findings = '';
    const fm = H.findings.exec(t);
    if (fm) {
      findings = t.slice(fm.index + fm[0].length);
      const stop = H.impression.exec(findings);
      if (stop) findings = findings.slice(0, stop.index);
      findings = findings.trim();
    }
    const exam = section(t, H.exam).split('\n')[0].trim();
    return { exam, history: section(t, H.history), findings, impression };
  }

  // ---- de-identifying

  function scrub(s) {
    return String(s || '')
      .replace(/^[ \t]*(?:electronically signed|signed by|dictated by|transcribed by|attending|i have personally reviewed)[^\n]*$/gim, '')
      .replace(/\b(?:MRN|accession|acc|patient|pt|name|DOB|date of birth)\s*[#:]\s*[^\n,;]*/gi, '[removed]')
      .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date]')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date]')
      .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/gi, '[date]')
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?/gi, '[time]')
      .replace(/\b\d{6,}\b/g, '[#]')
      .replace(/\b(?:Dr\.?|Doctor)\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g, 'Dr. [name]')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Numbering PowerScribe adds ("1.", "2)") is not style; drop it.
  function plainLines(s) {
    return String(s || '').split('\n').map((l) => l.replace(/^\s*(?:\d{1,2}[.)]|[-*•])\s+/, '').trim()).filter(Boolean).join('\n');
  }

  // ---- what kind of exam

  const MODS = [
    ['PET', /\bPET\b|\bFDG\b/i], ['NM', /\bNM\b|nuclear|scintigra|\bspect\b|bone scan|\bhida\b/i],
    ['MAMMO', /mammo|tomosynthesis|\bbreast\b.*\b(?:screen|diagnostic)\b/i],
    ['MR', /\bMR[IA]?\b|magnetic resonance/i], ['CT', /\bCTA?\b|computed tomography/i],
    ['US', /\bUS\b|ultrasound|sonogra|doppler|\bduplex\b/i], ['FL', /fluoro|esophagram|swallow|\bUGI\b/i],
    ['XR', /\bXR\b|\bCR\b|\bDX\b|radiograph|x-ray|\bviews?\b|\bPA\b|\bportable\b/i],
  ];
  const REGIONS = [
    ['head', /\bhead\b|brain|skull|orbit|sella|\biac\b|sinus|face|facial/i], ['neck', /\bneck\b|thyroid|soft tissue neck|larynx/i],
    ['spine', /spine|cervical|thoracic spine|lumbar|sacr|\bc-spine|\bl-spine|\bt-spine/i],
    ['chest', /chest|thorax|lung|pulmonary|\bcta chest|\bPE\b|cardiac|coronary|heart/i],
    ['abdomen', /abd|pelvi|liver|kidney|renal|pancrea|enterograph|urogra|colonograph|bladder|prostate|uterus|ovar|gallbladder|\bruq\b|appendi/i],
    ['breast', /breast|mammo/i], ['msk', /shoulder|knee|hip|ankle|wrist|hand|foot|elbow|femur|tibia|humerus|extremit|joint/i],
    ['vascular', /aort|carotid|venous|arterial|run-?off|angiogra/i],
  ];
  // "CT chest" style label, from the exam line (or the findings, when there is none).
  function examKind(exam, findings) {
    const src = exam || String(findings || '').slice(0, 400);
    const mod = (MODS.find(([, re]) => re.test(src)) || [''])[0];
    const regs = REGIONS.filter(([, re]) => re.test(src)).map(([k]) => k);
    return [mod, regs.slice(0, 2).join('+')].filter(Boolean).join(' ');
  }

  // ---- similarity

  const STOP = new Set('the a an and or of in on at to with without is are was were be been there this that no not seen within than from for by as which its it any into per mm cm visualized noted normal unremarkable appear appears appearance demonstrated identified evidence findings'.split(' '));
  function words(s) {
    const out = new Map();
    for (const w of String(s || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || []) if (!STOP.has(w)) out.set(w, (out.get(w) || 0) + 1);
    return out;
  }
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (const [w, n] of a) { na += n * n; if (b.has(w)) dot += n * b.get(w); }
    for (const [, n] of b) nb += n * n;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }
  function kindScore(k1, k2) {
    if (!k1 || !k2) return 0;
    const [m1, r1 = ''] = k1.split(' '), [m2, r2 = ''] = k2.split(' ');
    const regOverlap = r1 && r2 && r1.split('+').some((r) => r2.split('+').includes(r));
    return (m1 === m2 ? 0.5 : 0) + (regOverlap ? 0.5 : 0);
  }

  // ---- the collection

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  // A finished report -> an example, or { skip: why }.
  function fromReport(report, { source = 'manual', draft = '', now = Date.now() } = {}) {
    const p = split(report);
    if (p.findings.length < 40) return { skip: 'no findings' };
    if (p.impression.length < 5) return { skip: 'no impression' };
    const findings = scrub(p.findings).slice(0, 6000);
    const impression = plainLines(scrub(p.impression)).slice(0, 1500);
    const ex = {
      id: hash(findings.slice(0, 2000)),
      kind: examKind(p.exam, p.findings),
      exam: scrub(p.exam).slice(0, 120),
      history: scrub(p.history).slice(0, 500),
      findings,
      impression,
      source,
      added: new Date(now).toISOString(),
    };
    const d = plainLines(scrub(draft));
    if (d && d !== impression) ex.draft = d.slice(0, 1500); // what the AI wrote, when it was edited
    return ex;
  }

  // Add (the same findings again replace the older copy); oldest go first past the cap.
  function add(list, ex, max = MAX_EXAMPLES) {
    const out = (list || []).filter((x) => x.id !== ex.id);
    out.push(ex);
    while (out.length > max) out.shift();
    return out;
  }

  // Many reports pasted at once (a text export, or reports copied one after
  // another): split wherever a new report starts.
  function splitMany(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n');
    const starts = [];
    const re = /^[ \t]*(?:EXAMINATION|EXAM)[ \t]*:/gim;
    let m;
    while ((m = re.exec(t))) starts.push(m.index);
    if (starts.length < 2) {
      // No exam lines: a new report starts at each FINDINGS that follows an IMPRESSION.
      const parts = t.split(/\n[ \t]*(?:-{3,}|={3,}|_{3,})[ \t]*\n/);
      if (parts.length > 1) return parts.map((s) => s.trim()).filter(Boolean);
      const out = [];
      let cur = '';
      for (const line of t.split('\n')) {
        if (/^[ \t]*FINDINGS[ \t]*:/i.test(line) && /^[ \t]*IMPRESSION[ \t]*:/im.test(cur)) { out.push(cur.trim()); cur = ''; }
        cur += line + '\n';
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    return starts.map((s, i) => t.slice(s, starts[i + 1]).trim());
  }

  // The examples closest to this report.
  function pick(list, report, k = PICK) {
    const p = split(report);
    const findings = p.findings || String(report || '');
    const kind = examKind(p.exam, findings);
    const q = words(findings);
    const scored = (list || []).map((x) => ({ x, s: kindScore(kind, x.kind) + cosine(q, words(x.findings)) }))
      .sort((a, b) => b.s - a.s);
    const out = [];
    let used = 0;
    for (const { x } of scored) {
      if (out.length >= k) break;
      const size = x.findings.length + x.impression.length + x.history.length + 80;
      if (used + size > BUDGET && out.length) continue;
      out.push(x);
      used += size;
    }
    return out;
  }

  // The part of the system prompt that carries the examples ('' when none).
  function promptBlock(picked) {
    if (!picked || !picked.length) return '';
    const cut = (s, n) => (s.length > n ? s.slice(0, n) + ' [...]' : s);
    const ex = picked.map((x, i) => `EXAMPLE ${i + 1}${x.exam ? ' (' + x.exam + ')' : x.kind ? ' (' + x.kind + ')' : ''}\n` +
      (x.history ? 'History: ' + cut(x.history, 300) + '\n' : '') +
      'Findings: ' + cut(x.findings, 1800) + '\n' +
      'Impression the radiologist signed:\n' + x.impression).join('\n\n');
    return 'THIS RADIOLOGIST\'S OWN IMPRESSIONS\n' +
      'These are impressions this radiologist wrote and signed for earlier, similar studies. Write the new impression the way they would: match their wording, length, level of detail, how they phrase negative studies, comparisons and recommendations, and what they choose to leave out. Where their habit clearly differs from the FORM rules above (for example they keep sizes, or write a fuller negative line), follow their habit. Never copy a finding from an example: the examples show style only, and every statement must come from the new report.\n\n' +
      ex;
  }

  const api = { MAX_EXAMPLES, PICK, split, scrub, plainLines, examKind, fromReport, add, splitMany, pick, promptBlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGImpStyle = api;
})(typeof self !== 'undefined' ? self : this);
