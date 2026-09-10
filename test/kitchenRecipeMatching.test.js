import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExactRecipeMatchIndex,
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
