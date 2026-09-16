import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCatereaseViewSyncDeduper,
  isRecentCatereaseSync,
} from '../utils/catereaseViewSync.js';

test('view sync freshness avoids duplicate refreshes inside the short cooldown', () => {
  const now = Date.parse('2026-09-16T14:00:00Z');
  assert.equal(isRecentCatereaseSync('2026-09-16T13:59:30Z', { now }), true);
  assert.equal(isRecentCatereaseSync('2026-09-16T13:58:30Z', { now }), false);
  assert.equal(isRecentCatereaseSync('', { now }), false);
});

test('view sync deduper shares one pending request per event and permits the next refresh', async () => {
  const dedupe = createCatereaseViewSyncDeduper();
  let calls = 0;
  let release;
  const task = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = dedupe('event-1', task);
  const second = dedupe('event-1', task);
  await Promise.resolve();
  assert.equal(calls, 1);
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await second, 'done');
  assert.equal(await dedupe('event-1', async () => 'next'), 'next');
});
