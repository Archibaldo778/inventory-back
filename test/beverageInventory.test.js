import test from 'node:test';
import assert from 'node:assert/strict';

import BeverageItem from '../models/BeverageItem.js';
import { resolveBeverageInventoryDelta } from '../utils/beverageInventory.js';

test('beverage inventory movement types apply the correct stock direction', () => {
  assert.equal(resolveBeverageInventoryDelta('receive', 4), 4);
  assert.equal(resolveBeverageInventoryDelta('return', 2.5), 2.5);
  assert.equal(resolveBeverageInventoryDelta('usage', 3), -3);
  assert.equal(resolveBeverageInventoryDelta('waste', -1), -1);
  assert.equal(resolveBeverageInventoryDelta('adjustment', -2), -2);
  assert.equal(resolveBeverageInventoryDelta('invalid', 2), null);
  assert.equal(resolveBeverageInventoryDelta('receive', 0), null);
  assert.equal(resolveBeverageInventoryDelta('receive', 1_000_001), null);
});

test('beverage inventory schema contains stock and audit fields with safe defaults', () => {
  const item = new BeverageItem({ name: 'Test bottle' });
  assert.equal(item.stockOnHand, 0);
  assert.equal(item.reorderLevel, 0);
  assert.equal(item.active, true);
  assert.equal(item.unitType, 'bottle');
  assert.deepEqual(item.aliases, []);
  assert.deepEqual(item.inventoryMovements, []);
});
