import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardEventGuestCount } from '../utils/barGuestCount.js';
import {
  buildActiveDashboardBarEventQuery,
  buildDashboardBarSyncQuery,
  DASHBOARD_BAR_SYNC_SELECT,
} from '../utils/barDashboardSync.js';

test('dashboard-to-bar list sync reads only the bounded operational window', () => {
  const query = buildDashboardBarSyncQuery({ today: '2026-10-01' });
  assert.deepEqual(query.date, { $gte: '2026-09-01', $lte: '2026-12-30' });
  assert.equal(query.status.$not.test('deleted'), true);
  assert.equal(query.status.$not.test('cancelled'), true);
  assert.equal(query.status.$not.test('lost'), true);
  assert.deepEqual(query['meta.nowsta.excluded'], { $ne: true });
  assert.equal(DASHBOARD_BAR_SYNC_SELECT.includes('documents'), false);
  assert.equal(DASHBOARD_BAR_SYNC_SELECT.split(' ').includes('catereaseOperations'), false);
  assert.equal(DASHBOARD_BAR_SYNC_SELECT.includes('meta.nowsta.shifts'), true);
});

test('bar sync projection retains actual guest counts from Caterease and Dashboard aliases', () => {
  for (const [path, value, expected] of [
    ['catereaseOperations.guestCount', 220, 220],
    ['catereaseOperations.eventDetails.guestCount', 125, 125],
    ['meta.numberOfGuests', '1,250 guests', 1250],
    ['meta.number_of_guests', 75, 75],
    ['meta.pax', 90, 90],
  ]) {
    const source = { meta: { guestCount: 0 } };
    const setPath = (object, field, fieldValue) => {
      const keys = field.split('.');
      const last = keys.pop();
      keys.reduce((parent, key) => parent[key] ||= {}, object)[last] = fieldValue;
    };
    setPath(source, path, value);
    const projected = {};
    for (const field of DASHBOARD_BAR_SYNC_SELECT.split(' ')) {
      const fieldValue = field.split('.').reduce((parent, key) => parent?.[key], source);
      if (fieldValue !== undefined) setPath(projected, field, fieldValue);
    }
    assert.equal(dashboardEventGuestCount(projected), expected);
  }
});

test('captain event lists exclude events removed from Nowsta', () => {
  const query = buildActiveDashboardBarEventQuery();
  assert.deepEqual(query['meta.nowsta.excluded'], { $ne: true });
  assert.equal(query.status.$not.test('cancelled'), true);
  assert.equal(query.status.$not.test('active'), false);
});

test('single-event bar sync keeps exact lookup behavior outside the list window', () => {
  const query = buildDashboardBarSyncQuery({ eventId: 'outside-window-id', today: '2026-10-01' });
  assert.equal(query._id, 'outside-window-id');
  assert.equal(query.date, undefined);
});
