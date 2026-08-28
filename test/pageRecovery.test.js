import test from 'node:test';
import assert from 'node:assert/strict';

import Page from '../models/Page.js';

test('board pages support recoverable soft deletion', () => {
  const deletedAtPath = Page.schema.path('deletedAt');

  assert.ok(deletedAtPath, 'Page.deletedAt must exist so page deletion is reversible');
  assert.equal(deletedAtPath.options.default, null);
  assert.equal(deletedAtPath.options.index, true);
});
