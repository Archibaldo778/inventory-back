import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExactRecipeMatchIndex,
  canonicalKitchenRecipeName,
  findKitchenRecipeCandidates,
  normalizeKitchenRecipeName,
  resolveExactRecipeMatch,
} from '../utils/kitchenRecipeMatching.js';

test('normalizes punctuation, accents, ampersands and whitespace in recipe names', () => {
  assert.equal(
    normalizeKitchenRecipeName('  Crème brûlée & Berries  '),
    'creme brulee and berries'
  );
});

test('matches a kitchen dish to the newest active Caterease recipe by normalized name', () => {
  const recipes = [
    { _id: 'older', sourceId: '10', name: 'Roasted Salmon', revisedAt: '2026-01-01' },
    { _id: 'newer', sourceId: '11', name: 'Roasted  Salmon', revisedAt: '2026-08-01' },
  ];
  const result = resolveExactRecipeMatch('ROASTED-SALMON', buildExactRecipeMatchIndex(recipes));
  assert.equal(result.status, 'matched');
  assert.equal(result.recipe._id, 'newer');
  assert.equal(result.candidateCount, 2);
});

test('does not return a partial-name match', () => {
  const recipes = [{ _id: 'one', sourceId: '10', name: 'Roasted Salmon' }];
  const result = resolveExactRecipeMatch('Salmon', buildExactRecipeMatchIndex(recipes));
  assert.equal(result.status, 'unmatched');
});

test('canonical matching ignores dietary suffixes, prices and adjacent duplicate words', () => {
  assert.equal(canonicalKitchenRecipeName('Pickled Strawberry, Cream Cream Cheese (GF, NF) + 12'), 'pickled strawberry cream cheese');
  const recipes = [{ _id: 'one', name: 'Crab, White Chocolate, Caviar NF', ingredients: [{ name: 'Crab' }] }];
  const result = resolveExactRecipeMatch('Crab, White Chocolate, Caviar', buildExactRecipeMatchIndex(recipes));
  assert.equal(result.status, 'matched');
  assert.equal(result.recipe._id, 'one');
});

test('canonical matches prefer the same dish variant that contains ingredients', () => {
  const recipes = [
    { _id: 'empty-newer', name: 'Hamachi Taco', ingredients: [], revisedAt: '2026-09-01' },
    { _id: 'complete', name: 'Hamachi Taco GF, DF, NF', ingredients: [{ name: 'Hamachi' }], revisedAt: '2026-08-01' },
  ];
  const result = resolveExactRecipeMatch('Hamachi Taco', buildExactRecipeMatchIndex(recipes));
  assert.equal(result.recipe._id, 'complete');
});

test('recipe candidates are deduplicated and rank canonical matches first', () => {
  const recipes = [
    { _id: 'empty', name: 'Seared Halibut (NF)', ingredients: [] },
    { _id: 'complete', name: 'Seared Halibut GF, NF', ingredients: [{ name: 'Halibut' }] },
    { _id: 'other', name: 'Roasted Halibut', ingredients: [{ name: 'Halibut' }] },
  ];
  const candidates = findKitchenRecipeCandidates('Seared Halibut', recipes);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].recipe._id, 'complete');
  assert.equal(candidates[0].exact, true);
});
