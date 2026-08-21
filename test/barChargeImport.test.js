import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBarChargeImport } from '../utils/barChargeImport.js';

test('charge preview matches by event number and ignores rows outside the selected dates', () => {
  const preview = prepareBarChargeImport({
    from: '2026-08-04',
    to: '2026-08-10',
    events: [{ _id: 'bar-1', eventNumber: 'E22560', eventDate: '2026-08-08', name: 'Party', clientCharge: 0 }],
    rows: [
      { eventNumber: 'e22560', eventDate: '2026-08-08', beverageSubtotal: 18045, liquorSubtotal: 718 },
      { eventNumber: 'E100', eventDate: '2026-08-11', beverageSubtotal: 500, liquorSubtotal: 0 },
    ],
  });
  assert.equal(preview.summary.changes, 1);
  assert.equal(preview.summary.outsideRange, 1);
  assert.equal(preview.importableRows[0].clientCharge, 18763);
  assert.equal(preview.importableRows[0].eventId, 'bar-1');
});

test('conflicting duplicate charges are never importable', () => {
  const preview = prepareBarChargeImport({
    from: '2026-08-01',
    to: '2026-08-31',
    events: [{ _id: 'bar-1', eventNumber: 'E1', eventDate: '2026-08-08' }],
    rows: [
      { eventNumber: 'E1', eventDate: '2026-08-08', beverageSubtotal: 100, liquorSubtotal: 0 },
      { eventNumber: 'E1', eventDate: '2026-08-08', beverageSubtotal: 200, liquorSubtotal: 0 },
    ],
  });
  assert.equal(preview.summary.errors, 1);
  assert.equal(preview.summary.changes, 0);
  assert.equal(preview.rows[0].status, 'conflict');
});
