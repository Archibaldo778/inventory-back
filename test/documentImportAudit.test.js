import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDocumentsMatchSnapshot,
  applyBarDocumentImportSnapshot,
  barDocumentImportMatchesSnapshot,
  mergeEventDocumentHistory,
  nextEventDocumentVersion,
  snapshotEventDocuments,
  snapshotBarDocumentImport,
} from '../utils/documentImportAudit.js';

const document = (id, type, version) => ({
  _id: id,
  type,
  version,
  checksum: `${type}-${version}`,
  url: `/files/${id}.docx`,
  uploadedAt: `2026-08-${String(version).padStart(2, '0')}T12:00:00.000Z`,
});

test('bar import snapshots detect later operational edits and can be restored', () => {
  const event = {
    eventNumber: 'E100', guestCount: 100, guestCountSource: 'packout', status: 'ready', revision: 3,
    items: [{ name: 'Tequila', sentQty: 4 }], packout: { fileName: 'PO.docx' },
  };
  const snapshot = snapshotBarDocumentImport(event);
  assert.equal(barDocumentImportMatchesSnapshot(event, snapshot), true);
  event.items[0].sentQty = 5;
  assert.equal(barDocumentImportMatchesSnapshot(event, snapshot), false);
  applyBarDocumentImportSnapshot(event, snapshot);
  assert.equal(event.items[0].sentQty, 4);
});

test('document snapshots compare stable file identity fields', () => {
  const source = [document('one', 'po', 2)];
  const snapshot = snapshotEventDocuments(source);
  assert.equal(eventDocumentsMatchSnapshot(source, snapshot), true);
  assert.equal(eventDocumentsMatchSnapshot([document('two', 'po', 2)], snapshot), false);
});

test('document versions remain monotonic after an undo', () => {
  assert.equal(nextEventDocumentVersion('po', [document('one', 'po', 1)], [document('two', 'po', 3)]), 4);
  assert.equal(nextEventDocumentVersion('kitchen_menu', [], []), 1);
});

test('document history removes duplicate snapshots and keeps newest first', () => {
  const first = document('one', 'po', 1);
  const second = document('two', 'po', 2);
  const history = mergeEventDocumentHistory([first], [second, first]);
  assert.deepEqual(history.map((entry) => entry._id), ['two', 'one']);
});
