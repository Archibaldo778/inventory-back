import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropboxPathDateRangePattern,
  classifyDropboxEntry,
  buildDropboxRevisionPlan,
  findDropboxEventMatch,
  findDropboxFolderEventMatch,
  inferDropboxDocumentType,
  inferDropboxEventId,
  inferDropboxEventTitle,
  inferDropboxEventTitles,
  inferDropboxEventFolderPath,
  inferDropboxDocumentSeries,
  inferDropboxPathDate,
  inferDropboxRevision,
  nyToday,
  selectLatestDropboxFileRevisions,
  shouldReplaceDropboxEventDocument,
} from '../utils/dropboxDocuments.js';

test('Dropbox date-range pattern finds only paths inside the requested calendar range', () => {
  const pattern = buildDropboxPathDateRangePattern('2026-09-23', '2026-09-24');
  assert.equal(pattern.test('/2026/09 September/09-23-26 Event/SR/Event SR.xlsx'), true);
  assert.equal(pattern.test('/2026/09 September/2026-09-24 Event/KM.docx'), true);
  assert.equal(pattern.test('/2026/09 September/09-25-26 Event/PO.docx'), false);
});

test('Dropbox document names identify PO and Kitchen Menu files conservatively', () => {
  assert.equal(inferDropboxDocumentType('E22500 PO.docx'), 'po');
  assert.equal(inferDropboxDocumentType('Kitchen_Menu E22500.docx'), 'kitchen_menu');
  assert.equal(inferDropboxDocumentType('Event documents.docx'), 'review');
});

test('Dropbox document names recognize Caterease KPO and AKM variants', () => {
  assert.equal(inferDropboxDocumentType('09-05-26 Event Day 2 KPO.docx'), 'po');
  assert.equal(inferDropboxDocumentType('09-05-26 Event Day 2 AKM.docx'), 'kitchen_menu');
  assert.equal(inferDropboxEventTitle('09-05-26 Event Day 2 KPO.docx'), 'Event Day 2');
  assert.equal(inferDropboxEventTitle('09-05-26 Event Day 2 AKM.docx'), 'Event Day 2');
});

test('dated invoices and administrative DOCX files are ignored instead of sent to review', () => {
  const result = classifyDropboxEntry({
    '.tag': 'file',
    name: 'Cocktail Invoice.docx',
    path_display: '/Proposals (1)/2026/09 September/09 Olivier/09-10-26 Event/Cocktail Invoice.docx',
  }, { today: '2026-09-05' });
  assert.equal(result.status, 'ignored');
  assert.equal(result.documentType, 'review');
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

test('an operational file belongs to its physical event folder instead of a setup name in the filename', () => {
  const path = '/Proposals (1)/2026/09 September/09 Olivier/09-23-26 Chanel Breakfast/Leadership File/09-22-26 Chanel Breakfast Setup SR REV1.xlsx';
  const document = {
    name: '09-22-26 Chanel Breakfast Setup SR REV1.xlsx',
    path,
    inferredDate: inferDropboxPathDate(path),
    eventId: 'E22656',
  };
  assert.equal(document.inferredDate, '2026-09-22');
  const match = findDropboxFolderEventMatch(document, [
    { _id: 'setup', externalId: 'E22656 - S62015', title: 'Chanel Breakfast Setup', date: '2026-09-22' },
    { _id: 'breakfast', externalId: 'E22657 - S62018', title: 'Chanel Breakfast', date: '2026-09-23' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'breakfast');
});

test('multi-day series files use the file date instead of the shared Day 1 folder date', () => {
  const events = [
    { _id: 'day-one', externalId: 'E22900 - S62832', title: 'Hermes American Dream FW26 WRTW Trunkshow - Day 1', date: '2026-09-24' },
    { _id: 'day-two', externalId: 'E22904 - S62838', title: 'Hermes American Dream FW26 WRTW Trunkshow - Day 2', date: '2026-09-25' },
    { _id: 'day-three', externalId: 'E22905 - S62840', title: 'Hermes American Dream FW26 WRTW Trunkshow - Day 3', date: '2026-09-26' },
  ];
  const match = findDropboxFolderEventMatch({
    name: '09-25-26 Hermes American Dream FW26 WRTW Trunkshow SR_DAY 2.xlsx',
    path: '/Proposals/2026/09 September/09 Olivier/09-24-26 Hermes American Dream FW26 WRTW Trunkshow/SR/09-25-26 Hermes American Dream FW26 WRTW Trunkshow SR_DAY 2.xlsx',
    inferredDate: '2026-09-25',
  }, events);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'day-two');
  assert.equal(inferDropboxEventFolderPath(match.event && '/Proposals/2026/09 September/09 Olivier/09-24-26 Hermes American Dream FW26 WRTW Trunkshow/SR/09-25-26 Hermes American Dream FW26 WRTW Trunkshow SR_DAY 2.xlsx'), '/Proposals/2026/09 September/09 Olivier/09-24-26 Hermes American Dream FW26 WRTW Trunkshow');
});

test('multi-day series files do not require a DAY marker when the base event title matches', () => {
  const match = findDropboxFolderEventMatch({
    name: '09-25-26 Hermes American Dream FW26 WRTW Trunkshow Staff Request.xlsx',
    path: '/Proposals/2026/09 September/09 Olivier/09-24-26 Hermes American Dream FW26 WRTW Trunkshow/SR/09-25-26 Hermes American Dream FW26 WRTW Trunkshow Staff Request.xlsx',
    inferredDate: '2026-09-25',
  }, [
    { _id: 'day-one', title: 'Hermes American Dream FW26 WRTW Trunkshow - Day 1', date: '2026-09-24' },
    { _id: 'day-two', title: 'Hermes American Dream FW26 WRTW Trunkshow - Day 2', date: '2026-09-25' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'day-two');
});

test('a dated Setup file still belongs to its physical main-event folder', () => {
  const match = findDropboxFolderEventMatch({
    name: '09-22-26 Chanel Breakfast Setup Staff Request.xlsx',
    path: '/Proposals/2026/09 September/09 Olivier/09-23-26 Chanel Breakfast/SR/09-22-26 Chanel Breakfast Setup Staff Request.xlsx',
    inferredDate: '2026-09-22',
  }, [
    { _id: 'setup', title: 'Chanel Breakfast Setup', date: '2026-09-22' },
    { _id: 'breakfast', title: 'Chanel Breakfast', date: '2026-09-23' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'breakfast');
});

test('duplicate base event ids are resolved by the exact document title', () => {
  const match = findDropboxEventMatch({
    name: '09-14-26 Heyvaert Private Boat Cocktail KM.docx',
    inferredDate: '2026-09-14',
    eventId: 'E22869',
  }, [
    { _id: 'invoice', externalId: 'E22869 - S62700', title: 'Heyvaert Private Boat Cocktail - Invoice', date: '2026-09-14' },
    { _id: 'event', externalId: 'E22869 - S62704', title: 'Heyvaert Private Boat Cocktail', date: '2026-09-14' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'event');
});

test('folder title matching prefers the main event over its pack-out child event', () => {
  const match = findDropboxEventMatch({
    name: '09-12-26 Studio Sully Plans Bridgehampton Wedding KPO.docx',
    path: '/Proposals/09-12-26 Studio Sully Plans Bridgehampton Wedding/Leadership File/Kitchen/KPOs/09-12-26 Studio Sully Plans Bridgehampton Wedding KPO.docx',
    inferredDate: '2026-09-12',
  }, [
    { _id: 'main', externalId: 'E20244 - S57733', title: 'Studio Sully Plans Wedding of Rachael Sonnenberg & Martin de Crane', date: '2026-09-12' },
    { _id: 'child', externalId: 'E20244 - S62744', title: 'Studio Sully Plans Wedding of Rachael Sonnenberg & Martin de Crane - Pack Out - HD & Raw Bar', date: '2026-09-12' },
    { _id: 'staffing', externalId: '', title: 'Studio Sully Plans Wedding of Rachel Sonnenberg & Martin de Crane - Staffing', date: '2026-09-12' },
  ]);
  assert.equal(match.status, 'matched');
  assert.equal(match.event._id, 'main');
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

test('a numbered revision supersedes the original unnumbered document', () => {
  const base = '/Proposals/2026/September/09-11-2026 Event E22672';
  const plan = buildDropboxRevisionPlan([
    { dropboxId: 'original', path: `${base}/E22672 KM.docx`, name: 'E22672 KM.docx', documentType: 'kitchen_menu', inferredDate: '2026-09-11' },
    { dropboxId: 'rev-1', path: `${base}/E22672 KM REV1.docx`, name: 'E22672 KM REV1.docx', documentType: 'kitchen_menu', inferredDate: '2026-09-11' },
  ]);
  assert.equal(plan.find((row) => row.dropboxId === 'rev-1').isLatestRevision, true);
  assert.equal(plan.find((row) => row.dropboxId === 'original').status, 'superseded');
  assert.equal(plan.find((row) => row.dropboxId === 'original').supersededByDropboxId, 'rev-1');
});

test('event file listing keeps only the newest named revision in each document series', () => {
  const files = [
    { id: 'km-original', relativePath: 'Leadership Files/Event KM.docx', modifiedAt: '2026-09-18T10:00:00Z' },
    { id: 'km-rev-1', relativePath: 'Leadership Files/Event KM REV1.docx', modifiedAt: '2026-09-18T11:00:00Z' },
    { id: 'km-rev-3', relativePath: 'Leadership Files/Event KM Revision 3.docx', modifiedAt: '2026-09-18T12:00:00Z' },
    { id: 'po-rev-2', relativePath: 'Leadership Files/Event PO REV2.docx', modifiedAt: '2026-09-18T10:00:00Z' },
    { id: 'po-rev-2-newer', relativePath: 'Leadership Files/Event PO Revision 2.docx', modifiedAt: '2026-09-18T13:00:00Z' },
    { id: 'rental', relativePath: 'Leadership Files/Rental Order.pdf', modifiedAt: '2026-09-18T09:00:00Z' },
  ];
  assert.deepEqual(
    selectLatestDropboxFileRevisions(files).map((file) => file.id),
    ['km-rev-3', 'po-rev-2-newer', 'rental'],
  );
});

test('event file listing does not collapse unrelated unnumbered files', () => {
  const files = [
    { id: 'beverage', relativePath: 'Leadership Files/Beverage PO.docx' },
    { id: 'staff', relativePath: 'Leadership Files/Staff Request.xlsx' },
  ];
  assert.deepEqual(selectLatestDropboxFileRevisions(files), files);
});

test('event file revisions collapse across legacy and Leadership File container folders', () => {
  const files = [
    { id: 'legacy-km', relativePath: 'KM/09-21-26 Chanel Climate Week - US Circularity Event KM.docx' },
    { id: 'leadership-km', relativePath: 'Leadership File/KM/09-21-26 Chanel Climate Week - US Circularity Event KM REV1.docx' },
    { id: 'annotated', relativePath: 'Leadership File/Kitchen/09-21-26 Chanel Climate Week - US Circularity Event AKM.docx' },
  ];
  assert.deepEqual(
    selectLatestDropboxFileRevisions(files).map((file) => file.id),
    ['leadership-km', 'annotated'],
  );
});

test('event file revisions in real zone folders remain separate series', () => {
  const files = [
    { id: 'floor-1-old', relativePath: 'Leadership File/KM/First Floor/Event KM REV1.docx' },
    { id: 'floor-1-new', relativePath: 'KM/First Floor/Event KM REV2.docx' },
    { id: 'floor-2', relativePath: 'Leadership File/KM/Second Floor/Event KM REV1.docx' },
  ];
  assert.deepEqual(
    selectLatestDropboxFileRevisions(files).map((file) => file.id),
    ['floor-1-new', 'floor-2'],
  );
});

test('Staff Request and SR file names resolve to one latest event series', () => {
  const files = [
    { id: 'staff-original', relativePath: 'Staff Request/Staff Request Form.xlsx', modifiedAt: '2026-09-20T10:00:00Z' },
    { id: 'staff-rev-1', relativePath: 'Leadership File/SR/09-23-26 XTX Markets New York SR REV1.xlsx', modifiedAt: '2026-09-21T10:00:00Z' },
    { id: 'staff-rev-2', relativePath: 'Leadership File/SR/09-23-26 XTX Markets New York Staff Request REV2.xlsx', modifiedAt: '2026-09-22T10:00:00Z' },
  ];
  assert.deepEqual(
    selectLatestDropboxFileRevisions(files).map((file) => file.id),
    ['staff-rev-2'],
  );
});

test('a moved Dropbox file replaces its old event card by stable Dropbox id', () => {
  const incoming = { dropboxId: 'id:stable', name: 'Event KPO.docx', documentType: 'po' };
  assert.equal(shouldReplaceDropboxEventDocument({
    sourceProvider: 'dropbox',
    sourceId: 'id:stable',
    sourceSeries: 'old/path',
    fileName: 'KPO_Event.docx',
    type: 'po',
  }, incoming, 'new/path'), true);
});

test('a Dropbox revision replaces a matching manual document but preserves other Dropbox zones', () => {
  const incoming = { dropboxId: 'id:new', name: '09-12-26 Event KM REV3.docx', documentType: 'kitchen_menu' };
  assert.equal(shouldReplaceDropboxEventDocument({
    fileName: '09-12-26 Event KM REV1.docx', type: 'kitchen_menu', sourceSeries: '',
  }, incoming, 'event/km'), true);
  assert.equal(shouldReplaceDropboxEventDocument({
    sourceProvider: 'dropbox', sourceId: 'id:other', sourceSeries: 'event/other-kitchen',
    fileName: '09-12-26 Event KM REV1.docx', type: 'kitchen_menu',
  }, incoming, 'event/km'), false);
  assert.equal(shouldReplaceDropboxEventDocument({
    fileName: '09-12-26 Event AKM.docx', type: 'kitchen_menu', sourceSeries: '',
  }, incoming, 'event/km'), false);
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
