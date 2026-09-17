import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuestReceivedRows, applyGuestReturnRows, prepareGuestReturnRows } from '../utils/barGuestReturns.js';

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

test('captain return submission preserves and flags a count above received instead of rejecting it', () => {
  const items = [{
    _id: 'beer',
    name: 'Assorted Beer',
    scope: 'alcohol',
    included: true,
    sentQty: 64,
    deliveredQty: 64,
  }];
  const result = prepareGuestReturnRows(items, [{ itemId: 'beer', deliveredQty: 64, returnedQty: 68 }]);
  assert.equal(result.valid, true);
  assert.equal(result.updates[0].deliveredQty, 64);
  assert.equal(result.updates[0].returnedQty, 68);
  assert.deepEqual(result.variances, [{
    itemId: 'beer',
    name: 'Assorted Beer',
    deliveredQty: 64,
    returnedQty: 68,
    difference: 4,
  }]);
});

test('a real bottle under Cocktail Station is required, received, and returned consistently', () => {
  const bottle = {
    _id: 'ketel-one',
    name: 'Ketel One Vodka',
    section: 'Cocktail Station',
    scope: 'alcohol',
    included: true,
    sentQty: 6,
    deliveredQty: null,
    returnConfirmed: false,
  };
  const preparedDrink = {
    _id: 'espresso-martini',
    name: 'Espresso Martini',
    section: 'Specialty Cocktails',
    scope: 'review',
    included: true,
    sentQty: 50,
  };

  const received = applyGuestReceivedRows([bottle, preparedDrink], [
    { itemId: 'ketel-one', deliveredQty: 6 },
  ], { by: 'Captain Stephen' });
  assert.equal(received.valid, true);
  assert.equal(bottle.deliveredQty, 6);

  const returned = applyGuestReturnRows([bottle, preparedDrink], [
    { itemId: 'ketel-one', deliveredQty: 6, returnedQty: 2 },
  ], { by: 'Captain Stephen' });
  assert.equal(returned.valid, true);
  assert.equal(returned.updates.length, 1);
  assert.equal(returned.updates[0].item, bottle);
  assert.equal(bottle.returnedOpenQty, 2);
  assert.equal(bottle.returnConfirmed, true);
  assert.equal(bottle.updatedBy, 'Captain Stephen');
});

test('missing guest rows name the exact required bottle', () => {
  const items = [{
    _id: 'ketel-one', name: 'Ketel One Vodka', section: 'Cocktail Station', scope: 'alcohol', included: true,
  }];
  const received = applyGuestReceivedRows(items, []);
  const returned = prepareGuestReturnRows(items, []);
  assert.match(received.message, /Missing received quantity for: Ketel One Vodka/);
  assert.match(returned.message, /Missing returned quantity for: Ketel One Vodka/);
});
