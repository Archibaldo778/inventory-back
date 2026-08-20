import test from 'node:test';
import assert from 'node:assert/strict';
import { barItemIdentityKey, mergeManualItemsWithPackout } from '../utils/barManualItems.js';

test('manual liquor and cocktails keep stable catalog identities', () => {
  assert.equal(barItemIdentityKey({ beverageItemId: 'ABC123', name: 'Vodka' }), 'beverage:abc123');
  assert.equal(barItemIdentityKey({ cocktailRecipeKey: 'house-martini', name: 'Martini' }), 'cocktail:house-martini');
});

test('packout merge preserves manual items, drops their duplicates, and replaces old imported rows', () => {
  const existing = [
    { name: 'Tito’s Vodka', beverageItemId: 'a1', entrySource: 'manual', sentQty: 2 },
    { name: 'Old PO Rum', beverageItemId: 'old', entrySource: 'packout', sentQty: 3 },
    { name: 'House Martini', cocktailRecipeKey: 'house-martini', entrySource: 'manual', sentQty: 130 },
  ];
  const imported = [
    { name: 'Tito’s Vodka', beverageItemId: 'a1', sentQty: 5 },
    { name: 'New PO Gin', beverageItemId: 'gin', sentQty: 4 },
    { name: 'House Martini Cocktail', sentQty: 150 },
  ];
  assert.deepEqual(mergeManualItemsWithPackout(existing, imported), [
    existing[0],
    existing[2],
    { ...imported[1], entrySource: 'packout' },
  ]);
});
