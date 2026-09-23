import test from 'node:test';
import assert from 'node:assert/strict';
import { requireInventoryManager, requireWorkspaceAccess } from '../middleware/auth.js';
import { resolveProductMutationGuard, resolveProductWorkspaceGuard } from '../server.js';

test('inventory mutations require an inventory manager while preserving disposable intake', () => {
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/disposable' }), null);
  assert.equal(resolveProductMutationGuard({ method: 'POST', path: '/' }), requireInventoryManager);
  assert.equal(resolveProductMutationGuard({ method: 'PATCH', path: '/abc123' }), requireInventoryManager);
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
