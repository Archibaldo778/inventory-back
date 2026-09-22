import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationalDocumentActivities } from '../utils/operationalDocumentActivity.js';

const events = [{ _id: 'event-1', externalId: 'E22814', title: 'Chanel WRI Breakfast', date: '2026-09-23', managerId: 'Olivier Cheng' }];

test('operational activity keeps the latest document revision for each event and type', () => {
  const rows = buildOperationalDocumentActivities([
    { dropboxId: 'sr-1', path: '/09-23-26 Chanel WRI Breakfast/SR REV1.xlsx', name: 'SR REV1.xlsx', inferredDate: '2026-09-23', eventId: 'E22814', serverModifiedAt: '2026-09-22T10:00:00Z', firstSeenAt: '2026-09-22T10:01:00Z' },
    { dropboxId: 'sr-2', path: '/09-23-26 Chanel WRI Breakfast/SR_REV2.xlsx', name: 'SR_REV2.xlsx', inferredDate: '2026-09-23', eventId: 'E22814', serverModifiedAt: '2026-09-22T11:00:00Z', firstSeenAt: '2026-09-22T11:01:00Z' },
    { dropboxId: 'rental', path: '/09-23-26 Chanel WRI Breakfast/Rentals/PRL_WRI.pdf', name: 'PRL_WRI.pdf', inferredDate: '2026-09-23', eventId: 'E22814', serverModifiedAt: '2026-09-22T12:00:00Z', firstSeenAt: '2026-09-22T12:01:00Z' },
  ], events, { since: Date.parse('2026-09-22T00:00:00Z') });
  assert.deepEqual(rows.map((row) => [row.documentLabel, row.revision]), [['Rental', null], ['SR', 2]]);
  assert.equal(rows[1].action, 'revision');
});

test('operational activity excludes notes, samples, restricted files, and unmatched events', () => {
  const base = { inferredDate: '2026-09-23', eventId: 'E22814', firstSeenAt: '2026-09-22T12:00:00Z' };
  const rows = buildOperationalDocumentActivities([
    { ...base, dropboxId: 'notes', path: '/Event/Notes/Rental.xlsx', name: 'Rental.xlsx' },
    { ...base, dropboxId: 'sample', path: '/Event/Rentals/Sample Rentals.pdf', name: 'Sample Rentals.pdf' },
    { ...base, dropboxId: 'invoice', path: '/Event/PO/Invoice PO.pdf', name: 'Invoice PO.pdf' },
    { ...base, dropboxId: 'unknown', path: '/Other Event/KM.pdf', name: 'KM.pdf', eventId: 'E99999' },
  ], events, { since: Date.parse('2026-09-22T00:00:00Z') });
  assert.deepEqual(rows, []);
});

test('operational activity does not announce an old file merely because it was indexed today', () => {
  const rows = buildOperationalDocumentActivities([{
    dropboxId: 'old-file', path: '/09-23-26 Chanel WRI Breakfast/PO.docx', name: 'PO.docx',
    inferredDate: '2026-09-23', eventId: 'E22814', serverModifiedAt: '2026-09-01T12:00:00Z',
    firstSeenAt: '2026-09-22T12:00:00Z',
  }], events, { since: Date.parse('2026-09-22T00:00:00Z') });
  assert.deepEqual(rows, []);
});
