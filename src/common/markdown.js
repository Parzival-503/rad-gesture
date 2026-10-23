// A small, safe Markdown renderer for Reference Library notes. Shared by the
// Settings editor (live preview) and the reference viewer window.
//
// Safe by construction: every bit of text is HTML-escaped first, and the only
// tags that come out are the ones made here. Links only for http(s) and
// mailto. No raw HTML, no images from the web, no scripts.
//
// Supports what notes need: # headings (1-4), paragraphs (a single line
// break stays a line break), **bold**, *italic* / _italic_, ~~strike~~,
// ==highlight==, `code`, ``` code blocks ```, - / * / + lists, 1. lists
// (nested by indenting), - [ ] / - [x] check lists, > quotes (> **Note**
// makes a callout), --- rules, | tables |, [links](https://...) and bare
// https:// addresses.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RGMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function safeUrl(u) {
    const url = String(u).trim();
    return /^(https?:\/\/|mailto:)/i.test(url) ? url : '';
  }

  // Inline formatting on an already-escaped string.
  function inline(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const u = safeUrl(url.replace(/&amp;/g, '&'));
      return u ? `<a href="${esc(u)}">${label}</a>` : label;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${esc(url.replace(/&amp;/g, '&'))}">${url}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  }

  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  function renderList(lines, i) {
    // A run of list lines (and their deeper-indented children).
    const first = lines[i].match(LIST);
    const indent = first[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(LIST);
      if (!m) break;
      const ind = m[1].replace(/\t/g, '    ').length;
      if (ind < indent) break;
      if (ind > indent) {
        const sub = renderList(lines, i);
        if (items.length) items[items.length - 1].sub += sub.html;
        i = sub.next;
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      let body = m[3];
      let check = null;
      const t = body.match(/^\[( |x|X)\]\s+(.*)$/);
      if (t) { check = t[1] !== ' '; body = t[2]; }
      items.push({ body, check, sub: '' });
      i++;
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = `<${tag}${items.some((x) => x.check !== null) ? ' class="checks"' : ''}>` +
      items.map((x) => `<li${x.check === null ? '' : x.check ? ' class="done"' : ' class="todo"'}>${x.check === null ? '' : `<span class="box">${x.check ? '&#10003;' : ''}</span>`}${inline(x.body)}${x.sub}</li>`).join('') +
      `</${tag}>`;
    return { html, next: i };
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = line.match(/^```\s*(\w*)\s*$/))) {
        const body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      if ((m = line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/))) {
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        const callout = /^\*\*(note|tip|warning|important|caution|pearl|pitfall)\*\*/i.exec(body[0] || '');
        out.push(`<blockquote${callout ? ` class="callout ${callout[1].toLowerCase()}"` : ''}>${render(body.join('\n'))}</blockquote>`);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (/^:.*:$/.test(c) ? 'center' : /:$/.test(c) ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
        out.push(`<table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => td('td', r[k] || '', k)).join('')}</tr>`).join('') + '</tbody></table>');
        continue;
      }
      if (LIST.test(line)) {
        const l = renderList(lines, i);
        out.push(l.html);
        i = l.next;
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>)/.test(lines[i]) && !LIST.test(lines[i]) &&
        !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  // The first heading (or first line) as a title, for new notes.
  function titleOf(md) {
    const l = String(md || '').split(/\r?\n/).find((x) => x.trim());
    return l ? l.replace(/^#+\s*/, '').replace(/[*_`=~]/g, '').trim().slice(0, 80) : '';
  }

  return { render, inline, titleOf, esc };
});
