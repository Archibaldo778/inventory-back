import test from 'node:test';
import assert from 'node:assert/strict';

import { isBarAccountingItem, isExternalJelloItem } from '../utils/barPackoutScope.js';

test('externally supplied jello shots and jello bars are not bar inventory', () => {
  const rows = [
    { name: 'Vodka Jello Shots', section: 'ALCOHOL', scope: 'alcohol' },
    { name: 'Vodka', section: 'SOLID WIGGLES JELLO BAR', scope: 'alcohol' },
  ];

  assert.ok(rows.every(isExternalJelloItem));
  assert.ok(rows.every((item) => !isBarAccountingItem(item)));
  assert.equal(isBarAccountingItem({ name: 'Ketel One Vodka', section: 'SPIRITS', scope: 'alcohol' }), true);
});
