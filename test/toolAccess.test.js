import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, requireInventoryManager } from '../middleware/auth.js';
import { resolveToolAccessGuard } from '../server.js';

test('background removal is available to inventory managers including packers', () => {
  assert.equal(resolveToolAccessGuard({ method: 'POST', path: '/remove-background' }), requireInventoryManager);
  assert.equal(resolveToolAccessGuard({ method: 'POST', path: '/remove-background/' }), requireInventoryManager);
});

test('other image tools remain admin-only', () => {
  assert.equal(resolveToolAccessGuard({ method: 'POST', path: '/heif-to-jpg' }), requireAdmin);
  assert.equal(resolveToolAccessGuard({ method: 'GET', path: '/remove-background' }), requireAdmin);
});
