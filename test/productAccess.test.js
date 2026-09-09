import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../middleware/auth.js';
import { resolveProductMutationGuard } from '../server.js';

test('workspace users may create disposable inventory but not permanent decor', () => {
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/disposable' }), null);
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/' }), requireAdmin);
  assert.equal(resolveProductMutationGuard({ method: 'PATCH', path: '/abc123' }), requireAdmin);
});

test('all workspace product catalog reads remain safe', () => {
  assert.equal(resolveProductMutationGuard({ method: 'GET', path: '/' }), null);
  assert.equal(resolveProductMutationGuard({ method: 'HEAD', path: '/disposable' }), null);
});
