// The Reference Library ring as sections, and back.
//
// The ring is the record: each smaller ring of the Reference Library ring is
// a section (CT Chest, Abdomen...), holding links ("url:"), notes, pictures
// and files ("ref:<id>") and documents on this PC ("file:"). The Settings page
// edits a flat list of sections; pack() writes it back as a ring.
//
// Inside a section, a topic (LI-RADS, PI-RADS...) is a smaller ring holding
// several sources on one subject: a link, a PDF, a picture. read() gives a
// topic as { name, icon, topic: true, items }.
//
// A ring holds at most 8 directions, so pack() rolls what does not fit into a
// "More" smaller ring (marked more: true), at the top (sections) and inside a
// section (entries); sections() reads those back as one list. A section with
// nothing in it cannot be a ring (a smaller ring needs at least one
// direction), so it is kept on the ring's `emptySections` until something is
// added to it.
//
// Tools stay as they are, after the sections: a top-level direction that is
// not a section (My documents, Add from clipboard) and a smaller ring that
// only searches or runs tools ("Search copied text").
(function (root) {
  const MAX = 8;
  const isRing = (it) => !!it && Array.isArray(it.items);
  const act = (it) => String((it && it.action) || '');
  const isTool = (it) => (isRing(it) ? it.items.length > 0 && it.items.every((x) => /^(search|hub|helper):/.test(act(x))) : !/^(url|ref):/.test(act(it)));

  // Entries of a section (or a topic), following its "More" rings; a smaller
  // ring inside a section is a topic, its own entries read the same way.
  function entries(items, inTopic) {
    const out = [];
    for (const it of items || []) {
      if (isRing(it) && it.more) out.push(...entries(it.items, inTopic));
      else if (isRing(it) && !inTopic) out.push({ name: it.name, icon: it.icon || 'topic', topic: true, items: entries(it.items, true) });
      else out.push(it);
    }
    return out;
  }

  // -> { sections: [{ name, icon, items }], loose: [links/refs directly on
  //    the ring], tools: [...] }. Sections in ring order, "More" opened up.
  function read(ring) {
    const sections = [], loose = [], tools = [];
    const walk = (items) => (items || []).forEach((it) => {
      if (isRing(it) && it.more) return walk(it.items);
      if (isRing(it) && !isTool(it)) sections.push({ name: it.name, icon: it.icon || 'folder', items: entries(it.items) });
      else if (isTool(it)) tools.push(it);
      else loose.push(it);
    });
    walk(ring && ring.items);
    for (const e of (ring && ring.emptySections) || []) {
      if (!e || !e.name || e.in) continue;
      if (!sections.some((s) => s.name === e.name)) sections.push({ name: e.name, icon: e.icon || 'folder', items: [], at: e.at });
    }
    // An empty section goes back where it was in the list.
    const placed = sections.filter((s) => s.at === undefined);
    sections.filter((s) => s.at !== undefined).sort((a, b) => a.at - b.at)
      .forEach((s) => placed.splice(Math.min(s.at, placed.length), 0, s));
    placed.forEach((s) => delete s.at);
    // Empty topics wait the same way, inside their section.
    for (const e of (ring && ring.emptySections) || []) {
      if (!e || !e.name || !e.in) continue;
      const s = placed.find((x) => x.name === e.in);
      if (s && !s.items.some((x) => x.topic && x.name === e.name)) s.items.splice(Math.min(e.at || 0, s.items.length), 0, { name: e.name, icon: e.icon || 'topic', topic: true, items: [] });
    }
    return { sections: placed, loose, tools };
  }

  // A list as ring directions: at most MAX, the rest in a "More" ring.
  function fit(list, moreName, room = MAX) {
    if (list.length <= room) return list.slice();
    const keep = list.slice(0, room - 1);
    return keep.concat([{ name: moreName, icon: 'more_horiz', more: true, items: fit(list.slice(room - 1), moreName) }]);
  }

  // Sections + loose + tools -> the ring's items (and its empty sections).
  function pack(ring, { sections, loose, tools }) {
    const empty = [];
    const full = [];
    sections.forEach((s, i) => {
      const live = [];
      s.items.forEach((it, j) => {
        if (!it.topic) return live.push(it);
        if (it.items.length) live.push({ name: it.name, icon: it.icon || 'topic', items: fit(it.items, 'More') });
        else empty.push({ name: it.name, icon: it.icon || 'topic', in: s.name, at: j });
      });
      if (live.length) full.push({ name: s.name, icon: s.icon || 'folder', items: fit(live, 'More') });
      else empty.push({ name: s.name, icon: s.icon || 'folder', at: i });
    });
    const fixed = (loose || []).concat(tools || []);
    const room = Math.max(1, MAX - fixed.length);
    ring.items = fit(full, 'More sections', room).concat(fixed);
    if (empty.length) ring.emptySections = empty;
    else delete ring.emptySections;
    return ring;
  }

  // Where an entry sits: the section's index, or -1 (loose / nowhere).
  function sectionOf(lib, pred) {
    return lib.sections.findIndex((s) => s.items.some(pred));
  }

  // ---- moving things (drag and drop, Move up / down)
  //
  // An address: { sec } a section; { sec, idx } an entry of a section;
  // { sec, idx, sub } a source inside the topic at sec/idx; { tool } a tool.
  // move() takes the thing at `from` and puts it at `to`: before the entry
  // `to` names, or at the end of a section / topic when to.end is set.
  // Returns the new address, or null when the move makes no sense (a topic
  // into a topic, a section into an entry...).
  function listAt(lib, a) {
    const s = lib.sections[a.sec];
    if (!s) return null;
    if (a.sub === undefined) return s.items;
    const t = s.items[a.idx];
    return t && t.topic ? t.items : null;
  }
  function move(lib, from, to) {
    if (from.tool !== undefined) {
      if (to.tool === undefined) return null;
      return { tool: moveIn(lib.tools, from.tool, to.end ? lib.tools.length : to.tool) };
    }
    if (from.idx === undefined) {
      // A section: before another section, or last.
      if (to.idx !== undefined || to.tool !== undefined || !lib.sections[from.sec]) return null;
      return { sec: moveIn(lib.sections, from.sec, to.end ? lib.sections.length : to.sec) };
    }
    const src = listAt(lib, from);
    const i = from.sub === undefined ? from.idx : from.sub;
    if (!src || !src[i]) return null;
    const thing = src[i];
    // Where it lands: a list and an index in it.
    let dst, j;
    if (to.idx === undefined) { // the end of a section
      dst = lib.sections[to.sec] && lib.sections[to.sec].items;
      if (!dst) return null;
      j = dst.length;
    } else if (to.end && to.sub === undefined) { // the end of a topic
      const t = lib.sections[to.sec] && lib.sections[to.sec].items[to.idx];
      if (!t || !t.topic) return null;
      dst = t.items;
      j = dst.length;
    } else {
      dst = listAt(lib, to);
      if (!dst) return null;
      j = to.sub === undefined ? to.idx : to.sub;
    }
    const intoTopic = dst !== lib.sections[to.sec].items;
    if (thing.topic && intoTopic) return null; // no topic inside a topic
    if (dst === src) {
      const k = moveIn(src, i, j);
      return from.sub === undefined ? { sec: from.sec, idx: k } : { sec: from.sec, idx: from.idx, sub: k };
    }
    src.splice(i, 1);
    // Taking an entry out of the section its new topic is in can shift the topic.
    let topicIdx = to.idx;
    if (intoTopic && from.sub === undefined && from.sec === to.sec && from.idx < to.idx) topicIdx--;
    if (intoTopic) {
      const t = lib.sections[to.sec].items[topicIdx];
      t.items.splice(Math.min(j, t.items.length), 0, thing);
      return { sec: to.sec, idx: topicIdx, sub: Math.min(j, t.items.length - 1) };
    }
    dst.splice(Math.min(j, dst.length), 0, thing);
    return { sec: to.sec, idx: Math.min(j, dst.length - 1) };
  }
  // Move list[i] so it sits before what is now at j (j = length: last).
  // Returns where it ended up.
  function moveIn(list, i, j) {
    if (i < 0 || i >= list.length) return i;
    const [x] = list.splice(i, 1);
    const k = Math.max(0, Math.min(j > i ? j - 1 : j, list.length));
    list.splice(k, 0, x);
    return k;
  }

  const api = { MAX, read, pack, fit, entries, isTool, sectionOf, move, moveIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGRefLib = api;
})(typeof self !== 'undefined' ? self : this);
