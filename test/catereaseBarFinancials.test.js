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
});
