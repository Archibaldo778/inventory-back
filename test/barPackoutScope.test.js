import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isBarAccountingItem,
  isExternalJelloItem,
  isFoodMenuItem,
  isPackoutMetadataRow,
} from '../utils/barPackoutScope.js';

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

test('document metadata accidentally parsed as a cocktail never enters bar accounting', () => {
  const row = {
    name: 'Event Name: Lombardo Cocktail Date: Friday, September 11, 2026 Guest Count: 50 Client: Lombardo Location: 46 East 66th Street',
    section: '',
    scope: 'review',
    sentQty: 12320916904700,
    unitCostSnapshot: 3,
  };

  assert.equal(isPackoutMetadataRow(row), true);
  assert.equal(isBarAccountingItem(row), false);
});

test('impossible imported quantities never enter bar accounting', () => {
  assert.equal(isBarAccountingItem({
    name: 'House Cocktail',
    section: 'COCKTAIL',
    scope: 'review',
    sentQty: 100001,
  }), false);
});
