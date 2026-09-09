import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatereaseFinancialPreview, buildCatereaseKitchenCatalog } from '../utils/catereaseKitchen.js';

test('Caterease kitchen catalog joins menu items to ingredients and keeps reported costs', () => {
  const catalog = buildCatereaseKitchenCatalog({
    menuItems: [{ LocNum: '1', ItemNum: 'M10', ItemName: 'Roasted Carrots', Servings: '10', Cost: '25', Price: '90', Instructions: 'Roast' }],
    ingredients: [{ LocNum: '1', IRNum: 'I5', ItemName: 'Carrots', PUnitCost: '2.5', PUnitQty: '1', Vendor: 'Farm' }],
    menuItemRecipes: [{ LocNum: '1', ItemNum: 'M10', IRNum: 'I5', ItemName: 'Carrots', Qty: 4, Unit: 'lb', RServings: '10', PUnitCost: '2.5' }],
  });
  assert.equal(catalog.recipes.length, 1);
  assert.equal(catalog.recipes[0].costPerServing, 2.5);
  assert.equal(catalog.recipes[0].ingredients[0].name, 'Carrots');
  assert.equal(catalog.recipes[0].ingredients[0].quantity, 4);
  assert.equal(catalog.ingredients[0].purchaseUnitCost, 2.5);
});

test('Caterease sub-recipe composition follows LinkedIRNum as parent', () => {
  const catalog = buildCatereaseKitchenCatalog({
    ingredients: [
      { LocNum: '1', IRNum: 'SAUCE', ItemName: 'House Sauce', SubRecipe: 'true' },
      { LocNum: '1', IRNum: 'OIL', ItemName: 'Olive Oil' },
    ],
    ingredientRecipes: [{ LocNum: '1', LinkedIRNum: 'SAUCE', IRNum: 'OIL', ItemName: 'Olive Oil', Qty: 2, Unit: 'oz' }],
  });
  const sauce = catalog.ingredients.find((row) => row.sourceId === 'SAUCE');
  assert.equal(sauce.components.length, 1);
  assert.equal(sauce.components[0].sourceId, 'OIL');
});

test('Caterease financial preview groups client line-item charges without applying them', () => {
  const preview = buildCatereaseFinancialPreview({
    event: { eventId: 'E10' },
    includes: {
      financials: { _status: 'ok', data: { total: 1500, cost: 600, profit: 900 } },
      lineItems: { _status: 'ok', data: [
        { name: 'Wine', category: 'Beverage', quantity: 2, lineTotal: 200 },
        { name: 'Beer', category: 'Beverage', quantity: 3, lineTotal: 150 },
        { name: 'Food', category: 'Food', quantity: 1, lineTotal: 500 },
      ] },
    },
  });
  assert.equal(preview.financials.total, 1500);
  assert.deepEqual(preview.categoryTotals[0], { category: 'Food', items: 1, quantity: 1, lineTotal: 500 });
  assert.equal(preview.categoryTotals.find((row) => row.category === 'Beverage').lineTotal, 350);
});
