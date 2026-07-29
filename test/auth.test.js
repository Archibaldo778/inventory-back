import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { requireAuth } from '../middleware/auth.js';

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
      permissions: { seeProposals: false },
      isActive: true,
    });
    assert.equal(accepted.next, true);
    assert.equal(accepted.auth.role, 'user');

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
