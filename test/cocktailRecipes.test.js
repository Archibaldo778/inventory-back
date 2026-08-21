import test from 'node:test';
import assert from 'node:assert/strict';
import { cocktailServingsForGuests, resolveCocktailRecipeKey } from '../utils/cocktailRecipes.js';
import { DEFAULT_COCKTAIL_RECIPES } from '../utils/defaultCocktailRecipes.js';

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
});

test('cocktail production defaults to 1.3 portions per guest', () => {
  assert.equal(cocktailServingsForGuests(100), 130);
  assert.equal(cocktailServingsForGuests(25), 33);
  assert.equal(cocktailServingsForGuests(0), 0);
});
