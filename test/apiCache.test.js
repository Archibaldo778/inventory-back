import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCacheApiResponse } from '../utils/apiCache.js';

test('API cache stores only successful canonical requests', () => {
  assert.equal(shouldCacheApiResponse({ query: {} }, { statusCode: 200 }), true);
  assert.equal(shouldCacheApiResponse({ query: { cacheBust: '1' } }, { statusCode: 200 }), false);
  assert.equal(shouldCacheApiResponse({ query: {} }, { statusCode: 400 }), false);
  assert.equal(shouldCacheApiResponse({ query: {} }, { statusCode: 500 }), false);
});
