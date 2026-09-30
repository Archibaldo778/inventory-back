import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBarCatalogMatchTargets } from '../utils/barCatalogMatching.js';

test('a remembered alcohol match targets the same PO name in every existing event', () => {
  const targets = collectBarCatalogMatchTargets([
    { _id: 'event-1', items: [{ _id: 'one', name: 'Tito’s Vodka', beverageItemId: null }] },
    { _id: 'event-2', items: [{ _id: 'two', name: 'TITOS   VODKA', beverageItemId: 'old-item' }] },
    { _id: 'event-3', items: [{ _id: 'three', name: 'Hendrick’s Gin', beverageItemId: null }] },
  ], ['Titos Vodka'], 'catalog-item');

  assert.deepEqual(targets, [
    { eventId: 'event-1', itemIds: ['one'] },
    { eventId: 'event-2', itemIds: ['two'] },
  ]);
});

test('rows already linked to the selected catalog item are not rewritten', () => {
  assert.deepEqual(collectBarCatalogMatchTargets([
    { _id: 'event-1', items: [{ _id: 'one', name: 'By Ott Rosé', beverageItemId: 'catalog-item' }] },
  ], ['By Ott Rose'], 'catalog-item'), []);
});
