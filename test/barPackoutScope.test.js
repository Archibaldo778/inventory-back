import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPreparedBeverageType,
  isBarAccountingItem,
  isBarGlasswareItem,
  isBarInstructionItem,
  isClientProvidedBarItem,
  isGenericBarCategoryItem,
  isExternalJelloItem,
  isFoodMenuItem,
  isPackoutMetadataRow,
} from '../utils/barPackoutScope.js';

test('alcohol provided by a named client or venue is external supply', () => {
  const item = { name: 'Spirits & Wine provided by MoMA', section: 'WINE', scope: 'alcohol' };
  assert.equal(isClientProvidedBarItem(item), true);
  assert.equal(isBarAccountingItem(item), false);
  assert.equal(isClientProvidedBarItem({ name: 'Wine provided by OCC', scope: 'alcohol' }), false);
});

test('matched alcohol beneath a cocktail heading remains a bottle item', () => {
  const item = { name: 'Jean-Marc Millot', section: 'COCKTAIL', scope: 'alcohol' };
  assert.equal(getPreparedBeverageType(item), '');
});

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

test('OCC handling instructions are notes rather than alcohol products', () => {
  const item = {
    name: 'OCC to handling sparkling wine for cocktail',
    section: 'COCKTAIL',
    scope: 'alcohol',
  };
  assert.equal(isBarInstructionItem(item), true);
  assert.equal(isBarAccountingItem(item), false);
});

test('sales narratives about possible alcohol service remain notes', () => {
  const item = {
    name: 'Laura (bride) liked the idea of having some various whiskeys available at the bar for people to try, or perhaps doing a whiskey with dessert',
    section: 'SPIRITS',
    scope: 'alcohol',
  };
  assert.equal(isBarInstructionItem(item), true);
  assert.equal(isBarAccountingItem(item), false);
});

test('wine glasses and tumblers never become alcohol PO items', () => {
  const item = {
    name: 'Stockholm White Wine Glass or Tumbler',
    section: 'WINE',
    scope: 'alcohol',
  };
  assert.equal(isBarGlasswareItem(item), true);
  assert.equal(isBarAccountingItem(item), false);
});

test('generic combined alcohol categories wait for a specific PO item', () => {
  const item = {
    name: 'DINNER WINES AND CHAMPAGNE',
    section: 'SPARKLING WINE',
    scope: 'alcohol',
  };
  assert.equal(isGenericBarCategoryItem(item), true);
  assert.equal(isBarAccountingItem(item), false);
  assert.equal(isGenericBarCategoryItem({ name: 'Champagne & water' }), true);
  assert.equal(isBarAccountingItem({ name: 'Champagne & water', scope: 'alcohol' }), false);
  assert.equal(isGenericBarCategoryItem({ name: 'Veuve Clicquot Champagne' }), false);
});

test('explicit bottled water is tracked while a substitution instruction is only a note', () => {
  assert.equal(isBarAccountingItem({ name: 'Sparkling Water', scope: 'bar_support', sentQty: 12 }), true);
  assert.equal(isBarAccountingItem({
    name: 'MOCKTAIL VERSION TO BE AVAILABLE BY SUBBING SPARKLING WINE FOR SELTZER',
    scope: 'alcohol',
    sentQty: 0,
  }), false);
});

test('impossible imported quantities never enter bar accounting', () => {
  assert.equal(isBarAccountingItem({
    name: 'House Cocktail',
    section: 'COCKTAIL',
    scope: 'review',
    sentQty: 100001,
  }), false);
});
