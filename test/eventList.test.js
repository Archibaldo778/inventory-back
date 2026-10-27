import test from 'node:test';
import assert from 'node:assert/strict';
import { listEventsNewestFirst } from '../utils/eventList.js';
test('large event payloads are loaded without database sorting and returned in newest-first key order', async () => {
  const filter = { status: { $ne: 'deleted' } };
  const newest = { _id: 'new', title: 'New', meta: { snapshot: 'x'.repeat(1024) } };
  const oldest = { _id: 'old', title: 'Old' };
  let calls = 0;
  const Events = { find(query) {
    calls++;
    if (calls === 1) {
      assert.equal(query, filter);
      return { select(projection) {
        assert.equal(projection, '_id createdAt');
        return { sort(order) { assert.deepEqual(order, { createdAt: -1 }); return { lean: async () => [{ _id: 'new' }, { _id: 'removed' }, { _id: 'old' }] }; } };
      } };
    }
    assert.deepEqual(query, { $and: [filter, { _id: { $in: ['new', 'removed', 'old'] } }] });
    return { select(projection) { assert.equal(projection, '-documentHistory'); return Promise.resolve([oldest, newest]); } };
  } };
  assert.deepEqual(await listEventsNewestFirst(Events, filter), [newest, oldest]);
  assert.equal(calls, 2);
});
test('empty event lists avoid a second query', async () => {
  let calls = 0;
  const Events = { find: () => { calls++; return { select: () => ({ sort: () => ({ lean: async () => [] }) }) }; } };
  assert.deepEqual(await listEventsNewestFirst(Events, {}), []);
  assert.equal(calls, 1);
});
