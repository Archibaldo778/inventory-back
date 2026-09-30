import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBarReturnBatchItem } from '../utils/barReturnBatch.js';

test('batch return rejects returned plus lost quantities above the sent quantity', () => {
  const result = prepareBarReturnBatchItem({
    name: 'Vodka', sentQty: 5, deliveredQty: 5,
    returnedFullQty: 0, returnedOpenQty: 0, lostDamagedQty: 0,
  }, { returnedQty: 5, lostDamagedQty: 1 });
  assert.equal(result.valid, false);
  assert.match(result.message, /cannot exceed 5 sent/i);
});

test('batch return preserves previously saved full and lost quantities when the UI sends only returnedQty', () => {
  const result = prepareBarReturnBatchItem({
    name: 'Gin', sentQty: 10, deliveredQty: 10,
    returnedFullQty: 2, returnedOpenQty: 1, lostDamagedQty: 1,
  }, { returnedQty: 3 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, { returnedFullQty: 2, returnedOpenQty: 3, lostDamagedQty: 1 });
});

test('batch return accepts explicit detailed return fields', () => {
  const result = prepareBarReturnBatchItem({ sentQty: 8, deliveredQty: 8 }, {
    returnedFullQty: 4, returnedOpenQty: 1, lostDamagedQty: 2,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, { returnedFullQty: 4, returnedOpenQty: 1, lostDamagedQty: 2 });
});
