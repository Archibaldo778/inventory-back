import test from 'node:test';
import assert from 'node:assert/strict';
import { missingNowstaScheduleIds } from '../utils/nowstaReconciliation.js';

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
