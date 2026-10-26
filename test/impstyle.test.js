const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/common/impstyle');
const { createStyleStore } = require('../src/main/style-store');

// Invented reports only.
const CT_CHEST = `Patient: TEST, PERSON   MRN: 12345678   Accession: 99887766
EXAMINATION: CT CHEST WITH CONTRAST
CLINICAL HISTORY: Cough. Lung cancer status post lobectomy 03/12/2023.
COMPARISON: CT chest 1/2/2024.
TECHNIQUE: Axial images through the chest after IV contrast.
FINDINGS:
Lungs: Postsurgical changes of right upper lobectomy. New 8 mm nodule in the left lower lobe. No consolidation.
Pleura: No effusion.
Mediastinum: No lymphadenopathy.
IMPRESSION:
1. New left lower lobe nodule, suspicious for metastasis. PET-CT recommended.
2. No other evidence of recurrence.
Electronically signed by Dr. Jane Example on 4/5/2024 10:32 AM`;

const US_RUQ = `EXAMINATION: US ABDOMEN RUQ
HISTORY: Right upper quadrant pain.
FINDINGS:
Liver: Normal size and echotexture. No focal lesion.
Gallbladder: Multiple shadowing gallstones. Wall thickening and pericholecystic fluid. Positive sonographic Murphy sign.
Common bile duct: 4 mm.
IMPRESSION:
Acute calculous cholecystitis.`;

const MR_BRAIN = `EXAMINATION: MRI BRAIN WITHOUT CONTRAST
HISTORY: Headache.
FINDINGS:
No acute infarct, hemorrhage or mass. Ventricles and sulci are normal for age. Scattered small foci of T2 hyperintensity in the white matter.
IMPRESSION:
No acute intracranial abnormality.`;

test('a report splits into exam, history, findings and impression, without the header or signature', () => {
  const p = S.split(CT_CHEST);
  assert.strictEqual(p.exam, 'CT CHEST WITH CONTRAST');
  assert.match(p.history, /^Cough/);
  assert.match(p.findings, /^Lungs:/);
  assert.ok(!/IMPRESSION|COMPARISON/.test(p.findings));
  assert.match(p.impression, /^1\. New left lower lobe nodule/);
  assert.ok(!/signed/i.test(p.impression), 'the signature line is not the impression');
});

test('an example keeps no patient header, dates, long numbers or signer', () => {
  const ex = S.fromReport(CT_CHEST, { source: 'proofread' });
  const all = JSON.stringify(ex);
  for (const bad of ['12345678', '99887766', 'TEST, PERSON', '03/12/2023', '1/2/2024', 'Jane', '10:32']) assert.ok(!all.includes(bad), bad);
  assert.strictEqual(ex.kind, 'CT chest');
  assert.match(ex.history, /\[date\]/);
  assert.strictEqual(ex.impression, 'New left lower lobe nodule, suspicious for metastasis. PET-CT recommended.\nNo other evidence of recurrence.', 'numbering dropped');
});

test('a report without findings or impression is not kept', () => {
  assert.deepStrictEqual(S.fromReport('FINDINGS: short'), { skip: 'no findings' });
  assert.strictEqual(S.fromReport(CT_CHEST.replace(/IMPRESSION:[\s\S]*/, '')).skip, 'no impression');
});

test('the kind of exam is read from the exam line', () => {
  assert.strictEqual(S.examKind('US ABDOMEN RUQ'), 'US abdomen');
  assert.strictEqual(S.examKind('MRI BRAIN WO'), 'MR head');
  assert.strictEqual(S.examKind('XR CHEST 2 VIEWS'), 'XR chest');
  assert.strictEqual(S.examKind('CTA CHEST PE PROTOCOL'), 'CT chest');
  assert.strictEqual(S.examKind('PET/CT SKULL BASE TO THIGH'), 'PET head');
});

test('the same findings learned twice are kept once, and the newest wins', () => {
  let list = [];
  list = S.add(list, S.fromReport(US_RUQ));
  list = S.add(list, S.fromReport(US_RUQ.replace('Acute calculous cholecystitis.', 'Acute cholecystitis.')));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].impression, 'Acute cholecystitis.');
});

test('an edited AI draft is kept beside the signed impression; an unedited one is not', () => {
  assert.strictEqual(S.fromReport(US_RUQ, { draft: '1. Acute calculous cholecystitis.' }).draft, undefined);
  assert.strictEqual(S.fromReport(US_RUQ, { draft: 'Cholelithiasis with gallbladder wall thickening.' }).draft, 'Cholelithiasis with gallbladder wall thickening.');
});

test('the closest example comes first: same kind of exam, then similar findings', () => {
  const list = [MR_BRAIN, US_RUQ, CT_CHEST].map((r) => S.fromReport(r));
  const q = 'EXAMINATION: CT CHEST WITHOUT CONTRAST\nFINDINGS:\nLungs: A 5 mm nodule in the right middle lobe. No consolidation. No effusion.\nIMPRESSION:\n';
  const got = S.pick(list, q, 2);
  assert.strictEqual(got[0].kind, 'CT chest');
  assert.strictEqual(got.length, 2);
  const block = S.promptBlock(got);
  assert.match(block, /THIS RADIOLOGIST'S OWN IMPRESSIONS/);
  assert.match(block, /Never copy a finding from an example/);
  assert.strictEqual(S.promptBlock([]), '');
});

test('many reports pasted at once split into one example each', () => {
  const parts = S.splitMany([CT_CHEST, US_RUQ, MR_BRAIN].join('\n\n'));
  assert.strictEqual(parts.length, 3);
  const noExam = [US_RUQ, MR_BRAIN].map((r) => r.replace(/^EXAMINATION:.*\n/, '')).join('\n');
  assert.strictEqual(S.splitMany(noExam).length, 2, 'split at FINDINGS after an IMPRESSION');
  assert.strictEqual(S.splitMany(`${US_RUQ}\n-----\n${MR_BRAIN}`).length, 2, 'or at a dashed line');
});

test('the store learns, imports, removes and clears, on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-style-'));
  const st = createStyleStore({ userDir: () => dir });
  assert.deepStrictEqual(st.list(), []);
  assert.strictEqual(st.promptFor(CT_CHEST), '');
  const r = st.learn(CT_CHEST, { source: 'proofread' });
  assert.ok(r.saved && r.count === 1);
  assert.strictEqual(st.learn('nothing here').skip, 'no findings');
  const imp = st.importText([US_RUQ, MR_BRAIN, 'EXAMINATION: X\nno sections'].join('\n'));
  assert.deepStrictEqual([imp.added, imp.skipped, imp.count], [2, 1, 3]);
  assert.match(st.promptFor(CT_CHEST), /EXAMPLE 1 \(CT CHEST WITH CONTRAST\)/);
  st.remove(st.list()[0].id);
  assert.strictEqual(st.list().length, 2);
  st.clear();
  assert.deepStrictEqual(st.list(), []);
  assert.ok(fs.existsSync(st.file()));
});
