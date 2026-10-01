import test from 'node:test';
import assert from 'node:assert/strict';
import { missingNowstaScheduleIds, nowstaScheduleUpsert } from '../utils/nowstaReconciliation.js';

test('Nowsta sync preserves archived events and only restores events that are active in Nowsta', () => {
  const syncedAt = new Date('2026-10-01T12:00:00Z');
  const archived = nowstaScheduleUpsert({ nowstaEventId: 'event-1', archived: true }, syncedAt);
  assert.equal(archived.updateOne.update.$set.archived, true);
  assert.equal(archived.updateOne.update.$set.lastSyncedAt, syncedAt);
  assert.equal(nowstaScheduleUpsert({ nowstaEventId: 'event-1', archived: false }, syncedAt).updateOne.update.$set.archived, false);
});

test('a cancelled event missing from a successful Nowsta sync is removed from captain assignments', () => {
  const previous = [
    { nowstaEventId: 'christian-prada' },
    { nowstaEventId: 'active-event' },
  ];
  const current = [{ nowstaEventId: 'active-event' }];
  assert.deepEqual(missingNowstaScheduleIds(previous, current), ['christian-prada']);
});

test('current Nowsta events are never treated as removed', () => {
  assert.deepEqual(
    missingNowstaScheduleIds([{ nowstaEventId: 'event-1' }], [{ nowstaEventId: 'event-1' }]),
    [],
  );
});

test('legacy imported events are reconciled even without a schedule-entry row', () => {
  const previous = [{ meta: { nowsta: { apiEventId: 'tiffany-cancelled' } } }];
  assert.deepEqual(missingNowstaScheduleIds(previous, []), ['tiffany-cancelled']);
});
