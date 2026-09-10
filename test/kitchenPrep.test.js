import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKitchenPrepDish, calculateKitchenPrepList } from '../utils/kitchenPrep.js';

test('kitchen prep scales recipe quantities by guests and production percent', () => {
  const dish = buildKitchenPrepDish({
    kitchenItem: { _id: 'dish', name: 'Salmon' },
    recipe: {
      _id: 'recipe',
      name: 'Salmon',
      servings: 10,
      ingredients: [{ ingredientSourceId: 'salt', name: 'Salt', quantity: 2, unit: 'oz' }],
    },
  });
  const result = calculateKitchenPrepList({ guestCount: 100, productionPercent: 150, dishes: [dish] });
  assert.equal(result.portions, 150);
  assert.equal(result.dishes[0].ingredients[0].calculatedQuantity, 30);
  assert.equal(result.ingredientTotals[0].quantity, 30);
});

test('kitchen prep override changes only the selected sheet calculation', () => {
  const dish = buildKitchenPrepDish({
    recipe: { name: 'Soup', servings: 10, ingredients: [{ ingredientSourceId: 'stock', name: 'Stock', quantity: 5, unit: 'qt' }] },
  });
  dish.ingredients[0].overrideQuantity = 80;
  const result = calculateKitchenPrepList({ guestCount: 100, productionPercent: 100, dishes: [dish] });
  assert.equal(result.dishes[0].ingredients[0].calculatedQuantity, 50);
  assert.equal(result.dishes[0].ingredients[0].finalQuantity, 80);
  assert.equal(result.ingredientTotals[0].quantity, 80);
  assert.equal(dish.ingredients[0].baseQuantity, 5);
});
