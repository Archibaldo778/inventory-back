import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBarEventDate } from '../utils/barEventDates.js';

test('bar event sync normalizes dashboard date formats', () => {
  assert.equal(normalizeBarEventDate('2026-07-29'), '2026-07-29');
  assert.equal(normalizeBarEventDate('7/29/2026'), '2026-07-29');
  assert.equal(normalizeBarEventDate('07-29-2026'), '2026-07-29');
  assert.equal(normalizeBarEventDate('not a date'), '');
});
