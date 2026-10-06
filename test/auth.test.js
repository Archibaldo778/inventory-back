import AccessRole from '../models/AccessRole.js';
AccessRole.findById = () => ({ select: () => ({ lean: async () => null }) });
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { requireAuth, requireAdmin, requireInventoryManager, canSeeBarFinancials } from '../middleware/auth.js';

const userId = '507f1f77bcf86cd799439011';

const runGuard = async (token, persistedUser) => {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: () => ({
      lean: async () => persistedUser,
    }),
  });

  const req = { headers: { authorization: `Bearer ${token}` } };
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

  try {
    await requireAuth(req, res, () => {
      result.next = true;
      result.auth = req.auth;
    });
    return result;
  } finally {
    User.findById = originalFindById;
  }
};

test('requireAuth rejects refresh tokens and uses current database permissions', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-secret';
  try {
    const refreshToken = jwt.sign(
      { sub: userId, role: 'admin', tokenType: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const rejected = await runGuard(refreshToken, null);
    assert.equal(rejected.status, 401);

    const accessToken = jwt.sign(
      { sub: userId, role: 'admin', tokenType: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const accepted = await runGuard(accessToken, {
      _id: userId,
      username: 'current-user',
      email: 'current@example.com',
      role: 'user',
      seeProposals: false,
      seeBarFinancials: true,
      permissions: { seeProposals: false, seeBarFinancials: true },
      isActive: true,
    });
    assert.equal(accepted.next, true);
    assert.equal(accepted.auth.role, 'user');
    assert.equal(accepted.auth.permissions.seeBarFinancials, true);

    const revokedToken = jwt.sign(
      { sub: userId, role: 'user', tokenType: 'access', tokenVersion: 0 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const revoked = await runGuard(revokedToken, {
      _id: userId,
      role: 'user',
      isActive: true,
      tokenVersion: 1,
    });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.body.message, 'Session has been revoked');

    const inactive = await runGuard(accessToken, {
      _id: userId,
      role: 'admin',
      isActive: false,
    });
    assert.equal(inactive.status, 403);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('existing sales and assistants get admin access from persisted identity without migrating accounts', async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'sales-access-test-secret';
  try {
    const token = jwt.sign({ sub: userId, role: 'user', tokenType: 'access' }, process.env.JWT_SECRET);
    for (const profile of [{ role: 'sales rep' }, { role: 'user', jobTitle: 'assistant' }, { role: 'manager', jobTitle: 'team manager' }, { role: 'admin', jobTitle: 'sales' }]) {
      const stored = { _id: userId, ...profile, isActive: true, seeBarFinancials: false, seeProposals: false };
      const before = structuredClone(stored);
      const result = await runGuard(token, stored);
      assert.equal(result.next, true);
      assert.equal(result.auth.role, 'admin');
      assert.equal(canSeeBarFinancials(result.auth), true);
      assert.equal(result.auth.seeProposals, true);
      for (const guard of [requireAdmin, requireInventoryManager]) {
        let next = false;
        guard({ auth: result.auth }, { status() { assert.fail('Sales must have access'); } }, () => { next = true; });
        assert.equal(next, true);
      }
      assert.deepEqual(stored, before);
    }
    const staleSalesToken = jwt.sign({ sub: userId, role: 'sales rep', jobTitle: 'assistant', tokenType: 'access' }, process.env.JWT_SECRET);
    const demoted = await runGuard(staleSalesToken, { _id: userId, role: 'user', jobTitle: '', isActive: true });
    assert.equal(demoted.auth.role, 'user');
    assert.equal(demoted.auth.seeBarFinancials, false);
    const inactive = await runGuard(token, { _id: userId, role: 'sales rep', isActive: false });
    assert.equal(inactive.status, 403);
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});
