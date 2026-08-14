import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDecorInventoryCode,
  parseDecorInventoryCode,
} from '../utils/decorInventoryCodes.js';

test('decor inventory codes use stable OCC numbers', () => {
  assert.equal(formatDecorInventoryCode(1), 'OCC00001');
  assert.equal(formatDecorInventoryCode(99999), 'OCC99999');
  assert.equal(formatDecorInventoryCode(100000), 'OCC100000');
});

test('decor inventory code parser accepts only positive OCC codes', () => {
  assert.equal(parseDecorInventoryCode('occ00042'), 42);
  assert.equal(parseDecorInventoryCode('OCC00000'), null);
  assert.equal(parseDecorInventoryCode('42'), null);
  assert.equal(parseDecorInventoryCode('OCC12A'), null);
});
