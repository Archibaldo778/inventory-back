import test from 'node:test';
import assert from 'node:assert/strict';

import Page from '../models/Page.js';
import fs from 'node:fs';

test('board pages support recoverable soft deletion', () => {
  const deletedAtPath = Page.schema.path('deletedAt');

  assert.ok(deletedAtPath, 'Page.deletedAt must exist so page deletion is reversible');
  assert.equal(deletedAtPath.options.default, null);
  assert.equal(deletedAtPath.options.index, true);
});

test('page deletion requires an optimistic concurrency revision', () => {
  const source = fs.readFileSync(new URL('../routes/pages.js', import.meta.url), 'utf8');

  assert.match(source, /expectedRevision is required before deleting a page/);
  assert.match(source, /revision: expectedRevision/);
  assert.match(source, /PAGE_REVISION_CONFLICT/);
});
