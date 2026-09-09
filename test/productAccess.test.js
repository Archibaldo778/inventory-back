import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, requireWorkspaceAccess } from '../middleware/auth.js';
import { resolveProductMutationGuard, resolveProductWorkspaceGuard } from '../server.js';

test('workspace users may create disposable inventory but not permanent decor', () => {
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/disposable' }), null);
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/' }), requireAdmin);
  assert.equal(resolveProductMutationGuard({ method: 'PATCH', path: '/abc123' }), requireAdmin);
});

test('all workspace product catalog reads remain safe', () => {
  assert.equal(resolveProductMutationGuard({ method: 'GET', path: '/' }), null);
  assert.equal(resolveProductMutationGuard({ method: 'HEAD', path: '/disposable' }), null);
});

test('authenticated staff may resolve a scanned inventory QR without workspace access', () => {
  assert.equal(resolveProductWorkspaceGuard({ method: 'GET', path: '/code/OCC00440' }), null);
  assert.equal(resolveProductWorkspaceGuard({ method: 'HEAD', path: '/code/OCC00440/' }), null);
  assert.equal(resolveProductWorkspaceGuard({ method: 'GET', path: '/' }), requireWorkspaceAccess);
  assert.equal(resolveProductWorkspaceGuard({ method: 'PATCH', path: '/code/OCC00440' }), requireWorkspaceAccess);
});
