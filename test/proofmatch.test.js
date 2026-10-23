const test = require('node:test');
const assert = require('node:assert');
const PM = require('../src/common/proofmatch');

// Invented report text (no patient data).
const REPORT = 'FINDINGS:\nThe left lobe has a 4 mm nodule.\nThe right  lobe is clear.\nNo effusion. The left lobe is otherwise normal.';

test('each finding points at its own place, whatever order the findings come in', () => {
  const flags = [{ phrase: 'right lobe' }, { phrase: 'No effusion' }, { phrase: 'left lobe' }];
  const hits = PM.locate(REPORT, flags);
  assert.deepStrictEqual(hits.map((h) => h && h.idx), [1, 2, 3]);
  assert.strictEqual(REPORT.slice(hits[0].start, hits[0].end), 'right  lobe', 'across extra spaces');
  assert.strictEqual(REPORT.slice(hits[2].start, hits[2].end), 'left lobe');
  assert.ok(hits[2].start < hits[0].start, 'finding 3 sits earlier in the report than finding 1');
});

test('a phrase that is not in the text is reported as not found, without shifting the others', () => {
  const hits = PM.locate(REPORT, [{ phrase: 'pericardial effusion' }, { phrase: 'nodule' }]);
  assert.strictEqual(hits[0], null);
  assert.strictEqual(hits[1].idx, 2);
  assert.strictEqual(REPORT.slice(hits[1].start, hits[1].end), 'nodule');
});

test('the same phrase twice: each finding takes the next free place', () => {
  const hits = PM.locate(REPORT, [{ phrase: 'The left lobe' }, { phrase: 'the left lobe' }]);
  assert.ok(hits[0] && hits[1]);
  assert.notStrictEqual(hits[0].start, hits[1].start);
});

test('case and line breaks do not stop a match', () => {
  const hits = PM.locate('Mild\nATELECTASIS at the bases.', [{ phrase: 'mild atelectasis' }]);
  assert.strictEqual(hits[0].start, 0);
});

test('segments rebuild the report exactly, with each mark carrying its finding', () => {
  const flags = [{ phrase: 'right lobe' }, { phrase: 'missing words' }, { phrase: '4 mm' }];
  const segs = PM.segments(REPORT, flags);
  assert.strictEqual(segs.map((s) => s.text).join(''), REPORT);
  assert.deepStrictEqual(segs.filter((s) => s.idx).map((s) => s.idx), [3, 1]);
});

test('context shows the words around a finding', () => {
  const hit = PM.locate(REPORT, [{ phrase: '4 mm' }])[0];
  const c = PM.context(REPORT, hit, 12);
  assert.strictEqual(c.match, '4 mm');
  assert.ok(c.before.endsWith('has a '));
  assert.ok(c.after.startsWith(' nodule'));
  assert.strictEqual(PM.context(REPORT, null), null);
});

test('odd input is safe', () => {
  assert.deepStrictEqual(PM.locate('', [{ phrase: 'x' }]), [null]);
  assert.deepStrictEqual(PM.locate('abc', [{ phrase: '' }, {}]), [null, null]);
  assert.deepStrictEqual(PM.locate('a (b) [c]', [{ phrase: '(b) [c]' }])[0].start, 2);
});
