import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importedEventMatchesSnapshot,
  snapshotImportedEvent,
  summarizeImportOperations,
} from '../utils/eventImportAudit.js';

test('event import snapshots ignore unrelated documents and timestamps', () => {
  const event = {
    externalId: 'E100',
    title: 'Dinner',
    date: '2026-09-01',
    client: 'Client',
    managerId: 'Manager',
    status: 'scheduled',
    importSource: 'nowsta',
    meta: { venue: 'OCC' },
    documents: [{ fileName: 'PO.docx' }],
    updatedAt: new Date(),
  };
  const snapshot = snapshotImportedEvent(event);
  assert.equal(importedEventMatchesSnapshot({ ...event, documents: [] }, snapshot), true);
  assert.equal(importedEventMatchesSnapshot({ ...event, title: 'Changed' }, snapshot), false);
});

test('event import operation summary separates create update skip and failure', () => {
  assert.deepEqual(summarizeImportOperations([
    { action: 'created' },
    { action: 'updated' },
    { action: 'event_id_assigned' },
    { action: 'duplicates_merged' },
    { action: 'skipped' },
    { action: 'failed' },
  ]), {
    processed: 4,
    created: 1,
    updated: 3,
    eventIdsAssigned: 1,
    duplicatesMerged: 1,
    failed: 1,
    skipped: 1,
  });
});
