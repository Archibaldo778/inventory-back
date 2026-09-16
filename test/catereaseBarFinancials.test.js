import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCatereaseAlcoholClientCharges,
  applyCatereaseAlcoholClientChargesFromBundle,
} from '../utils/catereaseBarFinancials.js';

test('Caterease client pricing maps by normalized name only onto alcohol-scoped bar items', () => {
  const items = [
    { name: "Hendrick's Gin 750 ml", scope: 'alcohol' },
    { name: 'Panna Water', scope: 'bar_support' },
    { name: 'Wine bucket', scope: 'non_bar' },
  ];
  const summary = applyCatereaseAlcoholClientCharges(items, [
    { id: 'line-gin', name: 'Hendricks Gin', unitPrice: 85, lineTotal: 170 },
    { id: 'line-water', name: 'Panna Water', unitPrice: 8, lineTotal: 80 },
    { id: 'line-bucket', name: 'Wine bucket', unitPrice: 12, lineTotal: 24 },
  ]);
  assert.deepEqual(items[0].clientChargeSnapshot, { unitPrice: 85, lineTotal: 170, source: 'line-gin' });
  assert.equal(items[1].clientChargeSnapshot, undefined);
  assert.equal(items[2].clientChargeSnapshot, undefined);
  assert.deepEqual(summary, {
    alcoholLineItems: 1,
    matchedItems: 1,
    matchedLineItems: 1,
    unmatchedAlcoholLineItems: 0,
    lineItemChargeTotal: 170,
    billedBeverageLineItems: 1,
    billedBeverageTotal: 170,
    billedBeverageCharges: [{
      source: 'line-gin',
      name: 'Hendricks Gin',
      category: '',
      type: '',
      quantity: null,
      unitPrice: 85,
      lineTotal: 170,
    }],
  });
});

test('an unmatched Caterease alcohol line item is skipped without changing existing bar items', () => {
  const items = [{ name: 'Tito’s Vodka', scope: 'alcohol' }];
  const summary = applyCatereaseAlcoholClientCharges(items, [
    { id: 'line-gin', name: 'Bombay Sapphire Gin', unitPrice: 90, lineTotal: 180 },
  ]);
  assert.equal(items[0].clientChargeSnapshot, undefined);
  assert.equal(summary.matchedItems, 0);
  assert.equal(summary.unmatchedAlcoholLineItems, 1);
});

test('non-zero line item pricing is imported even when bundle financial totals are zero', () => {
  const items = [{ name: 'Veuve Clicquot Champagne', scope: 'alcohol' }];
  const summary = applyCatereaseAlcoholClientChargesFromBundle(items, {
    includes: {
      financials: { _status: 'ok', data: { total: 0, paid: 0, balanceDue: 0 } },
      lineItems: { _status: 'ok', data: [
        { id: 'line-champagne', name: 'Veuve Clicquot Champagne', unitPrice: 125, lineTotal: 500 },
      ] },
    },
  });
  assert.deepEqual(items[0].clientChargeSnapshot, { unitPrice: 125, lineTotal: 500, source: 'line-champagne' });
  assert.equal(summary.lineItemChargeTotal, 500);
  assert.equal(summary.billedBeverageTotal, 500);
});

test('aggregate Caterease beverage billing is preserved without inventing per-bottle allocation', () => {
  const items = [
    { name: 'Don Julio 1942', scope: 'alcohol' },
    { name: 'Yamazaki 12 year japanese whisky', scope: 'alcohol' },
  ];
  const summary = applyCatereaseAlcoholClientCharges(items, [
    { id: 'beverage-package', name: 'Beverage', category: 'Beverage', type: 'Beverage', quantity: 200, unitPrice: 110, lineTotal: 22000 },
    { id: 'wine-estimate', name: 'Dinner Wines ESTIMATE: Red and White at $70 per bottle', category: 'Beverage', type: 'Beverage', quantity: 1, unitPrice: 12180, lineTotal: 12180 },
    { id: 'premium-spirits', name: '1942 & Yamazaki', category: 'Beverage', type: 'Beverage', quantity: 1, unitPrice: 5100, lineTotal: 5100 },
    { id: 'food-with-alcohol-name', name: 'Champagne vinaigrette', category: 'Food', type: 'Food', quantity: 1, unitPrice: 25, lineTotal: 25 },
    { id: 'zero-detail', name: 'Yamazaki 12 year japanese whisky', category: 'Liquor', type: 'Liquor', quantity: 12, unitPrice: 0, lineTotal: 0 },
  ]);

  assert.equal(summary.billedBeverageLineItems, 3);
  assert.equal(summary.billedBeverageTotal, 39280);
  assert.deepEqual(summary.billedBeverageCharges.map((line) => line.source), [
    'beverage-package',
    'wine-estimate',
    'premium-spirits',
  ]);
  assert.deepEqual(items[0].clientChargeSnapshot, { unitPrice: null, lineTotal: null, source: '' });
  assert.deepEqual(items[1].clientChargeSnapshot, { unitPrice: 0, lineTotal: 0, source: 'zero-detail' });
});
