// Where each proofread finding sits in the report.
//
// Every finding is tied to its own place in the text by its index, so a
// click on finding 3 always lands on finding 3, whatever order the findings
// came in and whether or not earlier ones were found.
//
// A phrase matches case-insensitively and across any run of spaces or line
// breaks ("left  lobe" finds "left\nlobe"). When a phrase occurs more than
// once, each finding takes the first place no other finding has taken.
(function (root) {
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function phraseRe(phrase) {
    const words = String(phrase || '').trim().split(/\s+/).filter(Boolean).map(escapeRe);
    return words.length ? new RegExp(words.join('\\s+'), 'gi') : null;
  }

  // -> [{ idx, start, end } | null] in the findings' own order (idx = 1-based).
  function locate(text, flags) {
    const src = String(text || '');
    const taken = [];
    const free = (s, e) => taken.every((t) => e <= t.start || s >= t.end);
    return (flags || []).map((f, i) => {
      const re = phraseRe(f && f.phrase);
      if (!re) return null;
      let m;
      while ((m = re.exec(src))) {
        if (!m[0].length) break;
        const hit = { idx: i + 1, start: m.index, end: m.index + m[0].length };
        if (free(hit.start, hit.end)) {
          taken.push(hit);
          return hit;
        }
      }
      return null;
    });
  }

  // The report cut into plain text and marked pieces, in reading order.
  function segments(text, flags) {
    const src = String(text || '');
    const hits = locate(src, flags).filter(Boolean).sort((a, b) => a.start - b.start);
    const out = [];
    let at = 0;
    for (const h of hits) {
      if (h.start > at) out.push({ text: src.slice(at, h.start) });
      out.push({ text: src.slice(h.start, h.end), idx: h.idx });
      at = h.end;
    }
    if (at < src.length) out.push({ text: src.slice(at) });
    return out;
  }

  // A short piece of the report around a finding, for its card.
  function context(text, hit, pad = 48) {
    if (!hit) return null;
    const src = String(text || '');
    const s = Math.max(0, hit.start - pad);
    const e = Math.min(src.length, hit.end + pad);
    const flat = (t) => t.replace(/\s+/g, ' ');
    let before = flat(src.slice(s, hit.start));
    let after = flat(src.slice(hit.end, e));
    // Cut at a word boundary, and say text goes on with an ellipsis.
    if (s > 0) before = '…' + before.replace(/^\S*\s/, '');
    if (e < src.length) after = after.replace(/\s\S*$/, '') + '…';
    return { before, match: flat(src.slice(hit.start, hit.end)), after };
  }

  const api = { locate, segments, context, phraseRe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGProofMatch = api;
})(typeof self !== 'undefined' ? self : this);
