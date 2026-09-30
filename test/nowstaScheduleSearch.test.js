import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNowstaScheduleListQuery } from '../routes/nowstaSchedule.js';

test('Nowsta schedule search matches every title token without a calendar range', () => {
  const query = buildNowstaScheduleListQuery({ search: 'WSJ Magazine' });

  assert.equal(query.date, undefined);
  assert.equal(query.$and.length, 2);
  assert.equal(query.$and[0].$or[0].title.test('WSJ Innovator Awards'), true);
  assert.equal(query.$and[1].$or[0].title.test('WSJ Magazine Innovator Awards'), true);
});

test('Nowsta schedule list keeps the bounded date query when search is empty', () => {
  assert.deepEqual(buildNowstaScheduleListQuery({
    from: '2026-10-01',
    to: '2026-10-31',
  }), {
    date: { $gte: '2026-10-01', $lte: '2026-10-31' },
  });
});
