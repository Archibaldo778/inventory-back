import test from 'node:test';
import assert from 'node:assert/strict';

import { isBarAccountingItem, isExternalJelloItem, isFoodMenuItem } from '../utils/barPackoutScope.js';

test('externally supplied jello shots and jello bars are not bar inventory', () => {
  const rows = [
    { name: 'Vodka Jello Shots', section: 'ALCOHOL', scope: 'alcohol' },
    { name: 'Vodka', section: 'SOLID WIGGLES JELLO BAR', scope: 'alcohol' },
  ];

  assert.ok(rows.every(isExternalJelloItem));
  assert.ok(rows.every((item) => !isBarAccountingItem(item)));
  assert.equal(isBarAccountingItem({ name: 'Ketel One Vodka', section: 'SPIRITS', scope: 'alcohol' }), true);
});

test('food menu headings are excluded even when legacy data marks them as cocktails', () => {
  const rows = ['FIRST COURSE', 'PLATED DESSERT', 'PROTEINS', 'SIDES']
    .map((name) => ({ name, section: 'COCKTAIL', scope: 'review' }));

  assert.ok(rows.every(isFoodMenuItem));
  assert.ok(rows.every((item) => !isBarAccountingItem(item)));
});
