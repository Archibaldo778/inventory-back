import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBarEventDate, todayInTimeZone } from '../utils/barEventDates.js';

test('bar event sync normalizes dashboard date formats', () => {
  assert.equal(normalizeBarEventDate('2026-07-29'), '2026-07-29');
  assert.equal(normalizeBarEventDate('7/29/2026'), '2026-07-29');
  assert.equal(normalizeBarEventDate('07-29-2026'), '2026-07-29');
  assert.equal(normalizeBarEventDate('not a date'), '');
});

test('bar event sync uses the New York calendar day', () => {
  const instant = new Date('2026-07-30T02:00:00.000Z');
  assert.equal(todayInTimeZone(instant, 'America/New_York'), '2026-07-29');
});
