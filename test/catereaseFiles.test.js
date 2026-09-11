import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catereaseFileSeries,
  catereaseFileRevision,
  classifyCatereaseFile,
  normalizeCatereaseEventId,
  normalizeCatereaseFile,
  selectLatestCatereaseFiles,
} from '../utils/catereaseFiles.js';

test('Caterease event ids are extracted from Nowsta composite event numbers', () => {
  assert.equal(normalizeCatereaseEventId('E22824 - S62561'), 'E22824');
  assert.equal(normalizeCatereaseEventId('e-22824'), 'E22824');
  assert.equal(normalizeCatereaseEventId('S62561'), '');
});

test('Caterease files recognize operational PO and KM names and comments', () => {
  assert.equal(classifyCatereaseFile({ FileName: 'Day 2 KM.docx' }), 'kitchen_menu');
  assert.equal(classifyCatereaseFile({ FileName: 'Leadership document.docx', Comment: 'Beverage PO' }), 'po');
  assert.equal(classifyCatereaseFile({ FileName: 'Invoice.pdf' }), 'review');
});

test('Caterease metadata keeps UID identity and Revised timestamp', () => {
  const file = normalizeCatereaseFile({
    UID: 96,
    FileName: 'Event PO.docx',
    Comment: 'latest',
    Shared: false,
    Revised: '2026-08-14T15:22:41.113Z',
  }, 'E00470');
  assert.equal(file.uid, 96);
  assert.equal(file.catereaseEventId, 'E00470');
  assert.equal(file.documentType, 'po');
  assert.equal(catereaseFileRevision(file), '2026-08-14T15:22:41.113Z');
});

test('Caterease revisions share a series while separate zones remain independent', () => {
  const ballroomV1 = normalizeCatereaseFile({ UID: 101, FileName: 'Ballroom PO Revision 1.docx', Revised: '2026-09-01T10:00:00Z' }, 'E00470');
  const ballroomV2 = normalizeCatereaseFile({ UID: 102, FileName: 'Ballroom PO Revision 2.docx', Revised: '2026-09-02T10:00:00Z' }, 'E00470');
  const rooftop = normalizeCatereaseFile({ UID: 103, FileName: 'Rooftop PO Revision 1.docx', Revised: '2026-09-01T12:00:00Z' }, 'E00470');

  assert.equal(catereaseFileSeries(ballroomV1), catereaseFileSeries(ballroomV2));
  assert.notEqual(catereaseFileSeries(ballroomV2), catereaseFileSeries(rooftop));

  const plan = selectLatestCatereaseFiles([ballroomV1, rooftop, ballroomV2], 'E00470');
  assert.deepEqual(plan.latest.map((file) => file.uid).sort(), [102, 103]);
  assert.equal(plan.superseded.length, 1);
  assert.equal(plan.superseded[0].uid, 101);
  assert.equal(plan.superseded[0].supersededByUid, 102);
});

test('Caterease generic file names use the zone comment but ignore revision-only comments', () => {
  const rooftop = normalizeCatereaseFile({ UID: 201, FileName: 'Event PO.docx', Comment: 'Rooftop', Revised: '2026-09-01T10:00:00Z' }, 'E00470');
  const ballroom = normalizeCatereaseFile({ UID: 202, FileName: 'Event PO.docx', Comment: 'Ballroom', Revised: '2026-09-01T11:00:00Z' }, 'E00470');
  const generic = normalizeCatereaseFile({ UID: 203, FileName: 'Event PO.docx', Comment: 'Latest revision 3', Revised: '2026-09-01T12:00:00Z' }, 'E00470');

  assert.notEqual(rooftop.sourceSeries, ballroom.sourceSeries);
  assert.match(rooftop.sourceSeries, /:rooftop$/);
  assert.match(ballroom.sourceSeries, /:ballroom$/);
  assert.match(generic.sourceSeries, /:default$/);
});
