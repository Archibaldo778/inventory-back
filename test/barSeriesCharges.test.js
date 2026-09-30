import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSeriesCharge, findManualSeriesChargeConflict, selectBarEventSeries } from '../utils/barSeriesCharges.js';

test('Day 1 charge is distributed across nearby matching series days by guest count', () => {
  const events = [
    { _id: 'one', name: 'Gucci Appointments - Day 1', eventDate: '2026-09-24', client: 'Gucci', guestCount: 25 },
    { _id: 'two', name: 'Gucci Appointments - Day 2', eventDate: '2026-09-25', client: 'Gucci', guestCount: 75 },
    { _id: 'old', name: 'Gucci Appointments - Day 2', eventDate: '2025-09-25', client: 'Gucci', guestCount: 75 },
  ];
  const series = selectBarEventSeries(events, events[0]);
  assert.deepEqual(series.map((event) => event._id), ['one', 'two']);
  assert.deepEqual(allocateSeriesCharge(series, 100).map(({ amount, method }) => [amount, method]), [
    [25, 'guest_count'], [75, 'guest_count'],
  ]);
});

test('series charge falls back to equal cents when any day lacks guests', () => {
  const rows = [{ _id: 'one', guestCount: 10 }, { _id: 'two', guestCount: null }, { _id: 'three', guestCount: 10 }];
  assert.deepEqual(allocateSeriesCharge(rows, 100).map(({ amount }) => amount), [33.33, 33.33, 33.34]);
});

test('non-Day-1 events never initiate automatic redistribution', () => {
  const event = { name: 'Gucci Appointments - Day 2', eventDate: '2026-09-25' };
  assert.deepEqual(selectBarEventSeries([event], event), []);
});

test('an existing manual charge blocks automatic series allocation', () => {
  const events = [
    { _id: 'one', clientCharge: 100, clientChargeDetails: { source: 'caterease' } },
    { _id: 'two', clientCharge: 25, clientChargeDetails: { source: 'manual' } },
  ];
  assert.equal(findManualSeriesChargeConflict(events, 'one')._id, 'two');
  assert.equal(findManualSeriesChargeConflict([{ _id: 'two', clientCharge: 0 }], 'one'), null);
});
