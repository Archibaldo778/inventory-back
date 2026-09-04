import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDropboxEntry,
  buildDropboxRevisionPlan,
  findDropboxEventMatch,
  inferDropboxDocumentType,
  inferDropboxEventId,
  inferDropboxEventTitle,
  inferDropboxEventTitles,
  inferDropboxDocumentSeries,
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

test('Dropbox filenames expose a clean event title and match by title plus date', () => {
  assert.equal(inferDropboxEventTitle('09-05-26 James & Merry KM REV1.docx'), 'James & Merry');
  assert.equal(inferDropboxEventTitle('09-05-26 Merryl Tisch Dinner PO.docx'), 'Merryl Tisch Dinner');
  assert.equal(inferDropboxEventTitle('09-05-26 Merryl Tisch Dinner Staff Holding PO.docx'), 'Merryl Tisch Dinner');
  const match = findDropboxEventMatch({
    name: '09-05-26 Merryl Tisch Dinner PO.docx',
    inferredDate: '2026-09-05',
  }, [
    { _id: 'one', title: 'Other Event', date: '2026-09-05' },
    { _id: 'two', title: 'Merryl Tisch Dinner', date: '2026-09-05' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'two');
});

test('Dropbox documents match the event folder even when the filename is abbreviated', () => {
  const document = {
    name: '09-05-26 Merryl Tisch Dinner PO.docx',
    path: '/Proposals/2026/September/Emily/09-05-26 James & Merryl Tisch Host a Dinner/Leadership File/09-05-26 Merryl Tisch Dinner PO.docx',
    inferredDate: '2026-09-05',
  };
  assert.ok(inferDropboxEventTitles(document).includes('James & Merryl Tisch Host a Dinner'));
  const match = findDropboxEventMatch(document, [
    { _id: 'one', title: 'Other Event', date: '2026-09-05' },
    { _id: 'two', title: 'James & Merryl Tisch Host a Dinner', date: '2026-09-05' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'two');
});

test('Dropbox documents match DOCX metadata when folders and filenames are generic', () => {
  const match = findDropboxEventMatch({
    name: 'Revision 4.docx',
    path: '/Proposals/2026/Mess/New Folder/KM/Revision 4.docx',
    inferredDate: '2026-09-09',
    contentEventTitle: 'THSS27 VIP Backstage Catering - Day 6',
  }, [
    { _id: 'day-five', title: 'THSS27 VIP Backstage Catering - Day 5', date: '2026-09-08' },
    { _id: 'day-six', title: 'THSS27 VIP Backstage Catering - Day 6', date: '2026-09-09' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'day-six');
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
  assert.match(result.revisionGroupKey, /^E22825\|2026-09-18\|kitchen_menu\|/);
});

test('Dropbox document series removes revision noise but keeps hall and floor identity', () => {
  const first = inferDropboxDocumentSeries('/Proposals/2026/September/09-18-2026 E22825/Second Floor/KM Revision 1.docx');
  const next = inferDropboxDocumentSeries('/Proposals/2026/September/09-18-2026 E22825/Second Floor/Kitchen Menu Revision 2.docx');
  const otherFloor = inferDropboxDocumentSeries('/Proposals/2026/September/09-18-2026 E22825/Third Floor/KM Revision 2.docx');
  assert.equal(first, next);
  assert.notEqual(first, otherFloor);
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

test('Dropbox revision plan preserves multiple PO and Kitchen Menu series for one event', () => {
  const base = '/Proposals/2026/September/09-18-2026 Event E22825';
  const documents = [
    ['hall-a-1', 'Grand Hall', 'PO', 1, 'po'],
    ['hall-a-2', 'Grand Hall', 'PO', 2, 'po'],
    ['hall-b-1', 'Terrace', 'PO', 1, 'po'],
    ['hall-b-2', 'Terrace', 'PO', 2, 'po'],
    ['kitchen-a', 'Main Kitchen', 'Kitchen Menu', 1, 'kitchen_menu'],
    ['kitchen-b', 'Satellite Kitchen', 'Kitchen Menu', 1, 'kitchen_menu'],
  ].map(([dropboxId, area, label, revision, documentType]) => ({
    dropboxId,
    path: `${base}/${area}/${label} Revision ${revision}.docx`,
    name: `${label} Revision ${revision}.docx`,
    documentType,
    inferredDate: '2026-09-18',
  }));
  const plan = buildDropboxRevisionPlan(documents);
  const active = plan.filter((row) => row.isLatestRevision);
  assert.deepEqual(new Set(active.map((row) => row.dropboxId)), new Set(['hall-a-2', 'hall-b-2', 'kitchen-a', 'kitchen-b']));
  assert.equal(plan.find((row) => row.dropboxId === 'hall-a-1').supersededByDropboxId, 'hall-a-2');
  assert.equal(plan.find((row) => row.dropboxId === 'hall-b-1').supersededByDropboxId, 'hall-b-2');
});

test('Dropbox proposal paths recognize ISO and US dates', () => {
  assert.equal(inferDropboxPathDate('/Proposals/2026/September/09-18-2026 Event/PO.docx'), '2026-09-18');
  assert.equal(inferDropboxPathDate('/Proposals/2026/2026-10-02 Event/KM.docx'), '2026-10-02');
});

test('Dropbox series folders use each document filename date instead of the parent event date', () => {
  const sharedFolder = '/Proposals/2026/September/09-04-26 THSS27 VIP Backstage Catering - Day 1/KM';
  assert.equal(
    inferDropboxPathDate(`${sharedFolder}/09-09-26 THSS27 VIP Backstage Catering - Day 6 KM.docx`),
    '2026-09-09',
  );
  assert.equal(
    classifyDropboxEntry({
      '.tag': 'file',
      id: 'id:series-day-six',
      name: '09-09-26 THSS27 VIP Backstage Catering - Day 6 KM.docx',
      path_display: `${sharedFolder}/09-09-26 THSS27 VIP Backstage Catering - Day 6 KM.docx`,
    }, { today: '2026-09-04' }).inferredDate,
    '2026-09-09',
  );
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

test('Dropbox discovery rejects legacy Caterease folders even when their filenames are ambiguous', () => {
  const legacyEntry = {
    '.tag': 'file',
    id: 'id:legacy',
    name: 'Lincoln Passed HDs and Small Plates[1].docx',
    path_display: '/Proposals/2015/03 march/03 carlie/03-29-30-15 Lincoln Motor Company/Lincoln Passed HDs and Small Plates[1].docx',
  };
  const result = classifyDropboxEntry(legacyEntry, { today: '2026-09-04' });
  assert.equal(result.status, 'skipped_old');
  assert.equal(result.reason, 'Before the current New York date');
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

test('Dropbox discovery ignores loose DOCX files outside dated Caterease folders', () => {
  const result = classifyDropboxEntry({
    '.tag': 'file',
    id: 'id:loose',
    name: 'Cartier Wine Costs.docx',
    path_display: '/Proposals/Cartier Wine Costs.docx',
  }, { today: '2026-09-04' });
  assert.equal(result.status, 'ignored');
  assert.match(result.reason, /dated Caterease folder/i);
});
