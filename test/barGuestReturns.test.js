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

test('captain can correct the sent quantity before submitting returns', () => {
  const item = {
    _id: 'champagne', name: 'Champagne', scope: 'alcohol', included: true,
    sentQty: 12, sentQtyText: '12', sentQtyPending: false, deliveredQty: null,
  };
  const received = applyGuestReceivedRows([item], [
    { itemId: 'champagne', sentQty: 10, deliveredQty: 9 },
  ], { by: 'Captain Christian' });
  assert.equal(received.valid, true);
  assert.equal(item.sentQty, 10);
  assert.equal(item.sentQtyText, '10');
  assert.equal(item.deliveredQty, 9);

  const submitted = applyGuestReturnRows([item], [
    { itemId: 'champagne', sentQty: 11, deliveredQty: 9, returnedQty: 3 },
  ], { by: 'Captain Christian' });
  assert.equal(submitted.valid, true);
  assert.equal(item.sentQty, 11);
  assert.equal(item.sentQtyPending, false);
  assert.equal(item.returnedOpenQty, 3);
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

test('captain can submit final returns without inventing an Actual received count', () => {
  const item = {
    _id: 'aperol',
    name: 'Aperol',
    section: 'Spirits',
    scope: 'alcohol',
    included: true,
    sentQty: 10,
    deliveredQty: null,
    returnConfirmed: false,
  };

  const result = applyGuestReturnRows([item], [
    { itemId: 'aperol', deliveredQty: null, returnedQty: 4 },
  ], { by: 'Captain Stephen' });

  assert.equal(result.valid, true);
  assert.deepEqual(result.variances, []);
  assert.deepEqual(result.unverifiedReceived, [{
    itemId: 'aperol', name: 'Aperol', returnedQty: 4,
  }]);
  assert.equal(item.deliveredQty, null);
  assert.equal(item.returnedOpenQty, 4);
  assert.equal(item.returnConfirmed, true);
});

for (const apply of [applyGuestReceivedRows, applyGuestReturnRows]) {
  test(`${apply.name} preserves warehouse quantity and audits every correction, excluding pending counts`, () => {
    const item = { _id: 'a', name: 'Vodka', scope: 'alcohol', sentQty: 12 };
    const audit = [];
    const at = new Date('2026-10-05T12:00:00Z');
    const row = { itemId: 'a', sentQty: 10, deliveredQty: 10, returnedQty: 2 };
    assert.equal(apply([item], [row], { by: 'Captain', at, audit }).valid, true);
    assert.equal(item.sentQtyOriginal, 12);
    assert.equal(item.sentQtyChangedBy, 'Captain');
    assert.equal(item.sentQtyChangedAt, at);
    assert.deepEqual(audit[0].details, { itemId: 'a', name: 'Vodka', oldValue: 12, newValue: 10 });
    assert.equal(audit[0].username, 'Captain');
    apply([item], [{ ...row, sentQty: 11 }], { by: 'Second captain', at, audit });
    assert.equal(item.sentQtyOriginal, 12);
    assert.equal(audit.length, 2);
    assert.equal(audit[1].details.oldValue, 10);
    apply([item], [{ ...row, sentQty: 11 }], { audit });
    assert.equal(audit.length, 2);
    const pending = { _id: 'a', name: 'Vodka', scope: 'alcohol', sentQty: 0, sentQtyPending: true };
    apply([pending], [row], { by: 'Captain', at, audit });
    assert.equal(pending.sentQty, 10);
    assert.equal(pending.sentQtyOriginal, undefined);
    assert.equal(pending.sentQtyChangedBy, undefined);
    assert.equal(audit.length, 2);
  });
}
