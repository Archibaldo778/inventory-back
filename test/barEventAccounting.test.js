import test from 'node:test';
import assert from 'node:assert/strict';

import User from '../models/Users.js';
import {
  calculateBarEventAccounting,
  calculateBarItemAccounting,
} from '../utils/barEventAccounting.js';

test('bar item accounting subtracts full and partial returned bottles', () => {
  assert.deepEqual(
    calculateBarItemAccounting({
      sentQty: 10,
      returnedFullQty: 3,
      returnedOpenQty: 0.5,
      unitCostSnapshot: 24,
    }),
    {
      sentQty: 10,
      returnedFullQty: 3,
      returnedOpenQty: 0.5,
      returnedQty: 3.5,
      usedQty: 6.5,
      overReturnedQty: 0,
      unitCost: 24,
      actualCost: 156,
    }
  );
});

test('bar event accounting uses included items and final client charge', () => {
  const totals = calculateBarEventAccounting({
    clientCharge: 1000,
    items: [
      {
        included: true,
        sentQty: 10,
        returnedFullQty: 4,
        unitCostSnapshot: 20,
        returnConfirmed: true,
      },
      {
        included: false,
        sentQty: 100,
        returnedFullQty: 0,
        unitCostSnapshot: 50,
        returnConfirmed: false,
      },
    ],
  });

  assert.deepEqual(totals, {
    inventoryCost: 120,
    clientCharge: 1000,
    grossProfit: 880,
    marginPercent: 88,
    includedItemCount: 1,
    confirmedItemCount: 1,
  });
});

test('bar roles are valid user roles', () => {
  const rolePath = User.schema.path('role');
  assert.ok(rolePath.enumValues.includes('bar admin'));
  assert.ok(rolePath.enumValues.includes('bar captain'));
  assert.ok(rolePath.enumValues.includes('bartender'));
});
