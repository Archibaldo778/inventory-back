import test from 'node:test';
import assert from 'node:assert/strict';
import { barItemIdentityKey, mergeManualItemsWithPackout, mergePackoutDocumentItems, schedulePreparedItemsForEvent } from '../utils/barManualItems.js';

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

test('a Kitchen Menu import updates prepared drinks without deleting PO alcohol', () => {
  const existing = [
    { name: 'Belvedere', section: 'VODKA', scope: 'alcohol', entrySource: 'packout', sentQty: 4 },
    { name: 'Old Cocktail', section: 'COCKTAIL', scope: 'review', entrySource: 'packout', sentQty: 100 },
    { name: 'Manual Mezcal', section: 'Manual Liquor', scope: 'alcohol', entrySource: 'manual', sentQty: 1 },
  ];
  const kitchenMenu = [
    { name: 'New Cocktail', section: 'COCKTAIL', scope: 'review', sentQty: 130 },
  ];
  assert.deepEqual(mergePackoutDocumentItems(existing, kitchenMenu, ['kitchen_menu']), [
    existing[2],
    existing[0],
    { ...kitchenMenu[0], entrySource: 'packout' },
  ]);
});

test('a PO import updates products without deleting Kitchen Menu drinks', () => {
  const existing = [
    { name: 'Old Vodka', section: 'VODKA', scope: 'alcohol', entrySource: 'packout', sentQty: 2 },
    { name: 'KM Cocktail', section: 'COCKTAIL', scope: 'review', entrySource: 'packout', sentQty: 130 },
  ];
  const po = [{ name: 'New Gin', section: 'GIN', scope: 'alcohol', sentQty: 3 }];
  assert.deepEqual(mergePackoutDocumentItems(existing, po, ['po']), [
    existing[1],
    { ...po[0], entrySource: 'packout' },
  ]);
});

test('packout import schedules cocktails and mocktails on the event date without moving existing tasks', () => {
  const scheduledAt = new Date('2026-08-20T12:00:00Z');
  const items = [
    { name: 'Barefoot in the Grass', section: 'COCKTAIL', scope: 'review', prepTask: {} },
    { name: 'Sunset Sky', section: 'MOCKTAIL', scope: 'review', prepTask: {} },
    { name: 'Belvedere', section: 'VODKA', scope: 'alcohol', prepTask: {} },
    { name: 'Existing Prep', section: 'COCKTAIL', scope: 'review', prepTask: { scheduledDate: '2026-08-25' } },
  ];
  schedulePreparedItemsForEvent(items, '2026-08-26', { at: scheduledAt, by: 'director' });
  assert.equal(items[0].prepTask.scheduledDate, '2026-08-26');
  assert.equal(items[0].prepTask.scheduledBy, 'director');
  assert.equal(items[1].prepTask.scheduledDate, '2026-08-26');
  assert.equal(items[2].prepTask.scheduledDate, undefined);
  assert.equal(items[3].prepTask.scheduledDate, '2026-08-25');
});
