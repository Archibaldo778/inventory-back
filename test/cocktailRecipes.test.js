import test from 'node:test';
import assert from 'node:assert/strict';
import { cocktailServingsForGuests, resolveCocktailRecipeKey } from '../utils/cocktailRecipes.js';
import { DEFAULT_COCKTAIL_RECIPES } from '../utils/defaultCocktailRecipes.js';
import CocktailRecipe from '../models/CocktailRecipe.js';

test('cocktail recipes match PO names and aliases', () => {
  assert.equal(resolveCocktailRecipeKey('Yuzu Lychee Dream Cocktail'), 'yuzu-dream');
  assert.equal(resolveCocktailRecipeKey('Signature Maple Old Fashioned'), 'maple-old-fashioned');
  assert.equal(resolveCocktailRecipeKey('Cocktails'), '');
});

test('default cocktail recipes include bucket finalization instructions from operations', () => {
  const goldenNegroni = DEFAULT_COCKTAIL_RECIPES.find((recipe) => recipe.key === 'golden-negroni');
  const yuzuDream = DEFAULT_COCKTAIL_RECIPES.find((recipe) => recipe.key === 'yuzu-dream');
  assert.match(goldenNegroni.instructions, /20–30 seconds/);
  assert.match(yuzuDream.instructions, /Club Soda/);
  for (const recipe of DEFAULT_COCKTAIL_RECIPES) {
    assert.ok(recipe.instructions.trim(), `${recipe.name} is missing final instructions`);
  }
});

test('cocktail production defaults to 1.3 portions per guest', () => {
  assert.equal(cocktailServingsForGuests(100), 130);
  assert.equal(cocktailServingsForGuests(25), 33);
  assert.equal(cocktailServingsForGuests(0), 0);
});

test('shared recipe inventory distinguishes cocktails from mocktails', () => {
  const cocktail = new CocktailRecipe({ key: 'test-cocktail', name: 'Test Cocktail', ingredients: [{ name: 'Gin', amountMl: 45 }] });
  const mocktail = new CocktailRecipe({ key: 'test-mocktail', type: 'mocktail', name: 'Test Mocktail', ingredients: [{ name: 'Juice', amountMl: 60 }] });
  assert.equal(cocktail.type, 'cocktail');
  assert.equal(mocktail.type, 'mocktail');
  assert.equal(mocktail.validateSync(), undefined);
});
