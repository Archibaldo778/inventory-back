import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireAdmin,
  requireProposalAccess,
  requireWorkspaceAccess,
} from '../middleware/auth.js';
import { resolveUsersGuard } from '../server.js';

const ownId = '507f1f77bcf86cd799439011';
const otherId = '507f191e810c19729de860ea';

test('users access guard limits directory reads and allows self password changes', () => {
  assert.equal(resolveUsersGuard({
    method: 'GET',
    path: '/',
    auth: { userId: ownId, role: 'user' },
  }), requireAdmin);

  assert.equal(resolveUsersGuard({
    method: 'GET',
    path: '/options',
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

test('workspace guard blocks bar-only accounts from workspace APIs', () => {
  const runGuard = (role) => {
    const result = { status: null, body: null, next: false };
    const res = {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    };
    requireWorkspaceAccess({ auth: { role } }, res, () => {
      result.next = true;
    });
    return result;
  };

  assert.equal(runGuard('user').next, true);
  assert.equal(runGuard('manager').next, true);
  assert.equal(runGuard('sales rep').next, true);
  assert.equal(runGuard('bar admin').next, true);
  assert.equal(runGuard('admin').next, true);
  assert.equal(runGuard('super admin').next, true);
  assert.deepEqual(runGuard('bar captain'), {
    status: 403,
    body: { message: 'Workspace access required' },
    next: false,
  });
  assert.equal(runGuard('bartender').status, 403);
});
