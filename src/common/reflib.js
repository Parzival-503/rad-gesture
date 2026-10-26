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
// only searches ("Search copied text").
(function (root) {
  const MAX = 8;
  const isRing = (it) => !!it && Array.isArray(it.items);
  const act = (it) => String((it && it.action) || '');
  const isTool = (it) => (isRing(it) ? it.items.length > 0 && it.items.every((x) => /^(search|hub):/.test(act(x))) : !/^(url|ref):/.test(act(it)));

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

  const api = { MAX, read, pack, fit, entries, isTool, sectionOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RGRefLib = api;
})(typeof self !== 'undefined' ? self : this);
