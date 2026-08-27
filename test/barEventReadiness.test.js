import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBarEventReadiness } from '../utils/barEventReadiness.js';

test('bar readiness reports only included unmatched alcohol and prepared drinks without recipes', () => {
  const summary = summarizeBarEventReadiness({
    _id: 'bar-event',
    linkedEventId: 'dashboard-event',
    items: [
      { name: 'Unknown wine', scope: 'alcohol', beverageItemId: null },
      { name: 'Known wine', scope: 'alcohol', beverageItemId: 'inventory-id' },
      { name: 'House Smash', scope: 'bar_support', section: 'SPECIALTY COCKTAILS' },
      { name: 'Ready Mocktail', scope: 'bar_support', section: 'MOCKTAIL', cocktailRecipeKey: 'ready' },
      { name: 'Excluded wine', scope: 'alcohol', beverageItemId: null, included: false },
    ],
  });

  assert.deepEqual(summary, {
    eventId: 'bar-event',
    linkedEventId: 'dashboard-event',
    unmatchedAlcohol: 1,
    missingRecipes: 1,
    total: 2,
  });
});
