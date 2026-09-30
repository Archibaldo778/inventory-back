import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropboxRecipeCandidates,
  parseDropboxRecipeDetails,
  planDropboxRecipeSync,
} from '../utils/dropboxCocktailRecipes.js';

test('Dropbox Kitchen Menu recipes parse quantities and garnish instructions', () => {
  assert.deepEqual(parseDropboxRecipeDetails('Kitchen Menu recipe: 1.5 oz Gin, Lime 0.75 oz | Garnish: basil'), {
    ingredients: [
      { name: 'Gin', amountMl: 44.4, note: '' },
      { name: 'Lime', amountMl: 22.2, note: '' },
    ],
    instructions: 'Garnish: basil',
  });
});

test('only sufficiently detailed Kitchen Menu drinks become recipe candidates', () => {
  const documents = [{ type: 'kitchen_menu', sourceId: 'dbx-1', barItems: [
    { name: 'Garden Highball', preparedBeverageType: 'cocktail', notes: 'Kitchen Menu ingredients: Gin, Lime, Soda | Garnish: mint' },
    { name: 'Unknown Drink', preparedBeverageType: 'cocktail', notes: '' },
  ] }];
  assert.deepEqual(buildDropboxRecipeCandidates(documents).map((row) => row.name), ['Garden Highball']);
});

test('renamed cocktail with the same composition becomes an alias and updates garnish', () => {
  const existing = [{ _id: 'recipe-1', type: 'cocktail', name: 'Garden Highball', aliases: [], ingredients: [
    { name: 'Gin' }, { name: 'Lime' }, { name: 'Soda' },
  ], instructions: 'Garnish: mint' }];
  const candidate = {
    type: 'cocktail', name: 'Client Garden', ingredients: [{ name: 'Gin' }, { name: 'Lime' }, { name: 'Soda' }],
    instructions: 'Garnish: cucumber',
  };
  const [planned] = planDropboxRecipeSync([candidate], existing);
  assert.equal(planned.action, 'update');
  assert.deepEqual(planned.updates.aliases, ['Client Garden']);
  assert.equal(planned.updates.instructions, 'Garnish: cucumber');
});

test('two new names with the same composition create one recipe and one alias update', () => {
  const ingredients = [{ name: 'Gin' }, { name: 'Lime' }, { name: 'Soda' }];
  const plan = planDropboxRecipeSync([
    { key: 'garden-highball', type: 'cocktail', name: 'Garden Highball', ingredients },
    { key: 'client-garden', type: 'cocktail', name: 'Client Garden', ingredients },
  ], []);
  assert.deepEqual(plan.map((entry) => entry.action), ['create', 'skip']);
  assert.deepEqual(plan[0].candidate.aliases, ['Client Garden']);
});
