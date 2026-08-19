import test from 'node:test';
import assert from 'node:assert/strict';

import User from '../models/Users.js';
import {
  calculateBarEventAccounting,
  calculateBarItemAccounting,
  calculateBarPackageCharge,
  validateBarReturnQuantities,
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
      deliveredQty: null,
      outboundQty: 10,
      returnedFullQty: 3,
      returnedOpenQty: 0.5,
      returnedQty: 3.5,
      lostDamagedQty: 0,
      consumedQty: 6.5,
      usedQty: 6.5,
      overReturnedQty: 0,
      overAccountedQty: 0,
      unitCost: 24,
      actualCost: 156,
      returnRequired: true,
      preparedBeverageType: '',
    }
  );
});

test('bar item accounting uses delivered quantity and separates loss from consumption', () => {
  assert.deepEqual(
    calculateBarItemAccounting({
      sentQty: 12,
      deliveredQty: 10,
      returnedFullQty: 6,
      returnedOpenQty: 0.5,
      lostDamagedQty: 1,
      unitCostSnapshot: 20,
    }),
    {
      sentQty: 12,
      deliveredQty: 10,
      outboundQty: 10,
      returnedFullQty: 6,
      returnedOpenQty: 0.5,
      returnedQty: 6.5,
      lostDamagedQty: 1,
      consumedQty: 2.5,
      usedQty: 3.5,
      overReturnedQty: 0,
      overAccountedQty: 0,
      unitCost: 20,
      actualCost: 70,
      returnRequired: true,
      preparedBeverageType: '',
    }
  );
});

test('bar return validation rejects quantities that exceed the delivered amount', () => {
  const result = validateBarReturnQuantities({
    sentQty: 12,
    deliveredQty: 10,
    returnedFullQty: 9,
    returnedOpenQty: 0.5,
    lostDamagedQty: 1,
  });
  assert.equal(result.valid, false);
  assert.equal(result.accounting.overAccountedQty, 0.5);
  assert.match(result.message, /cannot exceed 10 sent/i);
});

test('cocktails and mocktails are fixed expenses that never require returns', () => {
  const cocktail = calculateBarItemAccounting({
    name: 'ARM IN ARM',
    section: 'SPECIALTY COCKTAIL',
    sentQty: 30,
    returnedFullQty: 30,
    unitCostSnapshot: 99,
  });
  const mocktail = calculateBarItemAccounting({
    name: 'Garden Spritz',
    section: 'MOCKTAIL',
    sentQty: 20,
  });

  assert.equal(cocktail.returnRequired, false);
  assert.equal(cocktail.returnedQty, 0);
  assert.equal(cocktail.consumedQty, 30);
  assert.equal(cocktail.unitCost, 3);
  assert.equal(cocktail.actualCost, 90);
  assert.equal(mocktail.returnRequired, false);
  assert.equal(mocktail.unitCost, 1.5);
  assert.equal(mocktail.actualCost, 30);
});

test('prepared beverages count toward event cost without blocking return submission', () => {
  const totals = calculateBarEventAccounting({
    clientCharge: 500,
    items: [{
      included: true,
      name: 'ARM IN ARM',
      section: 'SPECIALTY COCKTAIL',
      sentQty: 30,
      returnConfirmed: false,
    }],
  });

  assert.equal(totals.inventoryCost, 90);
  assert.equal(totals.grossProfit, 410);
  assert.equal(totals.includedItemCount, 1);
  assert.equal(totals.confirmedItemCount, 1);
});

test('bar package accounting applies event override, guests and overtime', () => {
  assert.deepEqual(calculateBarPackageCharge({
    guestCount: 100,
    packageSnapshot: {
      baseRate: 18,
      overrideRate: 20,
      priceUnit: 'per_person',
      serviceHours: 7,
      includedHours: 5,
      additionalHourRate: 250,
    },
  }), {
    priceUnit: 'per_person',
    baseRate: 18,
    overrideRate: 20,
    effectiveRate: 20,
    multiplier: 100,
    baseCharge: 2000,
    serviceHours: 7,
    includedHours: 5,
    additionalHours: 2,
    additionalHourRate: 250,
    overtimeCharge: 500,
    totalCharge: 2500,
  });
});

test('bar event accounting uses included items and final client charge', () => {
  const totals = calculateBarEventAccounting({
    clientCharge: 1000,
    items: [
      {
        included: true,
        scope: 'alcohol',
        sentQty: 10,
        returnedFullQty: 4,
        unitCostSnapshot: 20,
        returnConfirmed: true,
      },
      {
        included: false,
        scope: 'alcohol',
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
    packageCharge: 0,
    packageAccounting: {
      priceUnit: 'flat',
      baseRate: 0,
      overrideRate: null,
      effectiveRate: 0,
      multiplier: 1,
      baseCharge: 0,
      serviceHours: 0,
      includedHours: null,
      additionalHours: 0,
      additionalHourRate: 0,
      overtimeCharge: 0,
      totalCharge: 0,
    },
    includedItemCount: 1,
    confirmedItemCount: 1,
  });
});

test('old non-bar rows do not affect event totals', () => {
  const totals = calculateBarEventAccounting({
    clientCharge: 100,
    items: [
      { included: true, scope: 'alcohol', sentQty: 2, unitCostSnapshot: 10 },
      { included: true, scope: 'bar_support', section: 'WATER', name: 'Panna Water', sentQty: 50, unitCostSnapshot: 5 },
      { included: true, scope: 'non_bar', section: 'STAFF ITEMS', name: 'Paper cups', sentQty: 100, unitCostSnapshot: 2 },
    ],
  });

  assert.equal(totals.inventoryCost, 20);
  assert.equal(totals.includedItemCount, 1);
});

test('bar roles are valid user roles', () => {
  const rolePath = User.schema.path('role');
  assert.ok(rolePath.enumValues.includes('bar admin'));
  assert.ok(rolePath.enumValues.includes('bar captain'));
  assert.ok(rolePath.enumValues.includes('bartender'));
});
