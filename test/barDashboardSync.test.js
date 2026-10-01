import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(DASHBOARD_BAR_SYNC_SELECT.includes('catereaseOperations'), false);
  assert.equal(DASHBOARD_BAR_SYNC_SELECT.includes('meta.nowsta.shifts'), true);
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
