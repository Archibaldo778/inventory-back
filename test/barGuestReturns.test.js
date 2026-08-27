import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuestReceivedRows } from '../utils/barGuestReturns.js';

test('captain can save received quantities without confirming final returns', () => {
  const items = [
    { _id: 'a', name: 'Vodka', section: 'VODKA', scope: 'alcohol', included: true, sentQty: 3, sentQtyPending: false, returnConfirmed: false },
    { _id: 'b', name: 'Rosé', section: 'ROSÉ WINE', scope: 'alcohol', included: true, sentQty: 0, sentQtyPending: true, returnConfirmed: false },
  ];
  const result = applyGuestReceivedRows(items, [
    { itemId: 'a', deliveredQty: 3 },
    { itemId: 'b', deliveredQty: 4 },
  ], { at: new Date('2026-08-26T12:00:00Z'), by: 'Captain Ivan' });
  assert.equal(result.valid, true);
  assert.equal(items[0].deliveredQty, 3);
  assert.equal(items[0].returnConfirmed, false);
  assert.equal(items[1].sentQty, 4);
  assert.equal(items[1].sentQtyPending, false);
  assert.equal(items[1].deliveredQty, 4);
});

test('received save is atomic when a row is missing or duplicated', () => {
  const items = [
    { _id: 'a', name: 'Vodka', scope: 'alcohol', included: true, sentQty: 3, deliveredQty: null },
    { _id: 'b', name: 'Gin', scope: 'alcohol', included: true, sentQty: 2, deliveredQty: null },
  ];
  const result = applyGuestReceivedRows(items, [
    { itemId: 'a', deliveredQty: 3 },
    { itemId: 'a', deliveredQty: 2 },
  ]);

  assert.equal(result.valid, false);
  assert.equal(items[0].deliveredQty, null);
  assert.equal(items[1].deliveredQty, null);
});
