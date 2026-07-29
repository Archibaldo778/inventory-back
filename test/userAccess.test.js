import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, requireProposalAccess } from '../middleware/auth.js';
import { resolveUsersGuard } from '../server.js';

const ownId = '507f1f77bcf86cd799439011';
const otherId = '507f191e810c19729de860ea';

test('users access guard allows self password changes but protects other mutations', () => {
  assert.equal(resolveUsersGuard({
    method: 'GET',
    path: '/',
    auth: { userId: ownId, role: 'user' },
  }), requireProposalAccess);

  assert.equal(resolveUsersGuard({
    method: 'PUT',
    path: `/${ownId}/password`,
    auth: { userId: ownId, role: 'user' },
  }), null);

  assert.equal(resolveUsersGuard({
    method: 'PUT',
    path: `/${otherId}/password`,
    auth: { userId: ownId, role: 'user' },
  }), requireAdmin);

  assert.equal(resolveUsersGuard({
    method: 'PATCH',
    path: `/${ownId}`,
    auth: { userId: ownId, role: 'user' },
  }), requireAdmin);
});
