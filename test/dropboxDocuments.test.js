import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDropboxEntry,
  buildDropboxRevisionPlan,
  inferDropboxDocumentType,
  inferDropboxEventId,
  inferDropboxPathDate,
  inferDropboxRevision,
  nyToday,
} from '../utils/dropboxDocuments.js';

test('Dropbox document names identify PO and Kitchen Menu files conservatively', () => {
  assert.equal(inferDropboxDocumentType('E22500 PO.docx'), 'po');
  assert.equal(inferDropboxDocumentType('Kitchen_Menu E22500.docx'), 'kitchen_menu');
  assert.equal(inferDropboxDocumentType('Event documents.docx'), 'review');
});

test('Dropbox revision metadata recognizes event ids and common revision labels', () => {
  assert.equal(inferDropboxEventId('/E22825 - S62566/Kitchen Menu Revision 3.docx'), 'E22825');
  assert.deepEqual(inferDropboxRevision('Kitchen Menu REV-02.docx'), { number: 2, label: 'Revision 2' });
  assert.deepEqual(inferDropboxRevision('E22825 PO v4.docx'), { number: 4, label: 'Revision 4' });
  assert.deepEqual(inferDropboxRevision('E22825 PO.docx'), { number: null, label: '' });
});

test('Dropbox revision grouping uses the stable base event id and document type from folders', () => {
  const result = classifyDropboxEntry({
    '.tag': 'file',
    id: 'id:folder-type',
    name: 'Revision 2.docx',
    path_display: '/Proposals/2026/September/09-18-2026 Event E22825 - S62566/Kitchen Menu/Revision 2.docx',
  }, { today: '2026-09-04' });
  assert.equal(result.documentType, 'kitchen_menu');
  assert.equal(result.eventId, 'E22825');
  assert.equal(result.revisionNumber, 2);
  assert.equal(result.revisionGroupKey, 'E22825|2026-09-18|kitchen_menu');
});

test('Dropbox revision plan keeps only the highest explicit revision active', () => {
  const base = '/Proposals/2026/September/09-18-2026 Event E22825 - S62566';
  const plan = buildDropboxRevisionPlan([
    { dropboxId: 'one', path: `${base}/E22825 PO Revision 1.docx`, name: 'E22825 PO Revision 1.docx', documentType: 'po', inferredDate: '2026-09-18', serverModifiedAt: '2026-09-01' },
    { dropboxId: 'three', path: `${base}/E22825 PO Revision 3.docx`, name: 'E22825 PO Revision 3.docx', documentType: 'po', inferredDate: '2026-09-18', serverModifiedAt: '2026-09-03' },
    { dropboxId: 'two', path: `${base}/E22825 PO Revision 2.docx`, name: 'E22825 PO Revision 2.docx', documentType: 'po', inferredDate: '2026-09-18', serverModifiedAt: '2026-09-02' },
  ]);
  assert.equal(plan.find((row) => row.dropboxId === 'three').isLatestRevision, true);
  assert.equal(plan.find((row) => row.dropboxId === 'one').status, 'superseded');
  assert.equal(plan.find((row) => row.dropboxId === 'two').supersededByDropboxId, 'three');
});

test('Dropbox revision plan sends ambiguous unnumbered duplicates to review', () => {
  const base = '/Proposals/2026/September/09-18-2026 Event E22825';
  const plan = buildDropboxRevisionPlan([
    { dropboxId: 'a', path: `${base}/E22825 KM.docx`, name: 'E22825 KM.docx', documentType: 'kitchen_menu', inferredDate: '2026-09-18' },
    { dropboxId: 'b', path: `${base}/E22825 Kitchen Menu.docx`, name: 'E22825 Kitchen Menu.docx', documentType: 'kitchen_menu', inferredDate: '2026-09-18' },
  ]);
  assert.equal(plan.every((row) => row.status === 'review'), true);
});

test('Dropbox proposal paths recognize ISO and US dates', () => {
  assert.equal(inferDropboxPathDate('/Proposals/2026/September/09-18-2026 Event/PO.docx'), '2026-09-18');
  assert.equal(inferDropboxPathDate('/Proposals/2026/2026-10-02 Event/KM.docx'), '2026-10-02');
});

test('Dropbox discovery never queues files before the current New York date', () => {
  const oldEntry = {
    '.tag': 'file', id: 'id:old', name: 'PO.docx', path_display: '/Proposals/2026/August/08-31-2026 Event/PO.docx',
  };
  const futureEntry = {
    '.tag': 'file', id: 'id:new', name: 'KM.docx', path_display: '/Proposals/2026/September/09-18-2026 Event/KM.docx',
  };
  assert.equal(classifyDropboxEntry(oldEntry, { today: '2026-09-04' }).status, 'skipped_old');
  assert.equal(classifyDropboxEntry(futureEntry, { today: '2026-09-04' }).status, 'discovered');
});

test('Dropbox discovery sends missing dates to review instead of importing', () => {
  const entry = {
    '.tag': 'file', id: 'id:review', name: 'PO.docx', path_display: '/Proposals/2026/September/George/Event/PO.docx',
  };
  const result = classifyDropboxEntry(entry, { today: '2026-09-04' });
  assert.equal(result.status, 'review');
  assert.match(result.reason, /date/i);
  assert.match(nyToday(new Date('2026-09-04T15:00:00Z')), /^2026-09-04$/);
});
