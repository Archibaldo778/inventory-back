import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchRecognizedItemsToCatalog,
  parseRecognizedPackout,
} from '../utils/barPackoutRecognition.js';

test('recognized Form Parser rows preserve sections and quantities', () => {
  const result = parseRecognizedPackout({
    text: 'Event: Sample Event\nEvent Number: E100',
    tables: [{
      headerRows: [['Name', 'Qty', 'Notes/Comments', 'Delivered', 'Returned']],
      bodyRows: [
        ['ALCOHOL', '', '', '', ''],
        ['Titos Vodka (1 L)', '4', '', '', ''],
        ['COCKTAIL WINES', '', '', '', ''],
        ['Sancerre, Romain Reverdy (White)', '16', '', '', ''],
        ['WATER', '', '', '', ''],
        ['Panna Water', '12', '', '', ''],
        ['Pellegrino', '18', '', '', ''],
        ['Generic Water', '10', '', '', ''],
        ['SPECIALTY COCKTAIL', '', '', '', ''],
        ['ARM IN ARM', '30', '', '', ''],
        ['GARNISH: Edible Flower', '30', '', '', ''],
        ['Cocktail napkins', '200', '', '', ''],
        ['STAFF ITEMS', '', '', '', ''],
        ['Paper plates', '6', '', '', ''],
      ],
    }],
  });
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items.map((item) => [item.name, item.quantity, item.scope]), [
    ['Titos Vodka (1 L)', 4, 'alcohol'],
    ['Sancerre, Romain Reverdy (White)', 16, 'alcohol'],
    ['Panna Water', 12, 'bar_support'],
    ['Pellegrino', 18, 'bar_support'],
    ['ARM IN ARM', 30, 'bar_support'],
  ]);
  assert.equal(result.items[4].returnRequired, false);
  assert.equal(result.items[4].unitCostSnapshot, 3);
  assert.equal(result.packoutType, 'bar_only');
  assert.equal(result.metadata.eventName, 'Sample Event');
});

test('recognized names match exact aliases and leave ambiguous suggestions unconfirmed', () => {
  const catalog = [
    { _id: 'a1', name: 'Tito’s Handmade Vodka', aliases: ['Titos Vodka', 'Titos Vodka 1L'] },
    { _id: 'a2', name: 'Panna Water', aliases: [] },
    { _id: 'a3', name: 'Pellegrino Sparkling Water', aliases: [] },
  ];
  const matched = matchRecognizedItemsToCatalog([
    { name: 'TITOS VODKA (1 L)' },
    { name: 'Panna' },
    { name: 'Unknown bottle' },
  ], catalog);
  assert.equal(matched[0].beverageItemId, 'a1');
  assert.equal(matched[0].catalogMatch.status, 'exact');
  assert.equal(matched[1].beverageItemId, null);
  assert.equal(matched[1].catalogMatch.status, 'suggested');
  assert.equal(matched[2].beverageItemId, null);
  assert.equal(matched[2].catalogMatch.status, 'unmatched');
});

test('Domaine Ott PO wording matches the existing By.Ott inventory item', () => {
  const matched = matchRecognizedItemsToCatalog([
    { name: 'Domaine Ott, Cotes de Provence Rose' },
  ], [{
    _id: 'ott-rose',
    name: 'Domaines Ott By.Ott Rosé',
    aliases: ['By Ott (Rosé)'],
  }]);
  assert.equal(matched[0].beverageItemId, 'ott-rose');
  assert.equal(matched[0].catalogMatch.status, 'exact');
});

test('Milken PO shorthand matches existing wine and assorted beer inventory', () => {
  const catalog = [
    { _id: 'sancerre', name: 'Sancerre, Romain Reverdy', aliases: ['Sancerre, Romain Reverdy (White)'] },
    { _id: 'pinot', name: 'Bench Sonoma Coast Pinot Noir', aliases: ['Pinot Noir, Bench Sonoma Coast (Red)'] },
    { _id: 'beer', name: 'Beer (Assorted)', aliases: ['Beer Assorted'] },
  ];
  const matched = matchRecognizedItemsToCatalog([
    { name: 'Sancerre, Domaine Reverdy', section: 'HOUSE COCKTAIL/ DINNER WINE', scope: 'alcohol' },
    { name: 'Pinot Noir, Bench', section: 'HOUSE COCKTAIL/ DINNER WINE', scope: 'alcohol' },
    { name: 'Assorted', section: 'BEER', scope: 'alcohol' },
  ], catalog);

  assert.deepEqual(matched.map((item) => item.beverageItemId), ['sancerre', 'pinot', 'beer']);
  assert.ok(matched.every((item) => item.catalogMatch.status === 'exact'));
});
