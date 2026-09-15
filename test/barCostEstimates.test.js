import test from 'node:test';
import assert from 'node:assert/strict';

import { barCostFamily, estimateBarItemUnitCost } from '../utils/barCostEstimates.js';

const catalog = [
  { name: 'Tito\'s Handmade Vodka', category: 'Hard Liquors', subCategory: 'Vodka', purchaseCost: 27.6 },
  { name: 'Belvedere Vodka', category: 'Hard Liquors', subCategory: 'Vodka', purchaseCost: 35 },
  { name: 'Grey Goose Vodka', category: 'Hard Liquors', subCategory: 'Vodka', purchaseCost: 39 },
  { name: 'Sancerre', category: 'Wine', subCategory: 'White Wine', purchaseCost: 18 },
  { name: 'Chablis', category: 'Wine', subCategory: 'White Wine', purchaseCost: 22 },
];

test('unknown vodka receives the median purchase cost of vodka inventory peers', () => {
  const result = estimateBarItemUnitCost({ name: 'Ketel One', section: 'Manual Liquor', scope: 'alcohol' }, catalog);
  assert.equal(barCostFamily({ name: 'Ketel One', section: 'Manual Liquor' }), 'vodka');
  assert.equal(result.unitCost, 35);
  assert.deepEqual(result.estimate, {
    estimated: true,
    kind: 'vodka',
    basis: 'vodka inventory median (3)',
    needsPriceCheck: false,
  });
});

test('unknown wine receives an estimated wine cost marked for price checking', () => {
  const result = estimateBarItemUnitCost({ name: 'House Sancerre', section: 'WHITE WINE', scope: 'alcohol' }, catalog);
  assert.equal(result.unitCost, 20);
  assert.equal(result.estimate.kind, 'white_wine');
  assert.equal(result.estimate.needsPriceCheck, true);
});

test('cocktails and mocktails retain fixed rates without requiring recipes', () => {
  const cocktail = estimateBarItemUnitCost({ name: 'House Special', section: 'Cocktails' }, catalog);
  const mocktail = estimateBarItemUnitCost({ name: 'Garden Fizz', section: 'Mocktails' }, catalog);
  assert.equal(cocktail.unitCost, 3);
  assert.equal(mocktail.unitCost, 1.5);
  assert.equal(cocktail.estimate.estimated, false);
  assert.equal(mocktail.estimate.estimated, false);
});
