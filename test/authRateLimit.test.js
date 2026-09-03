import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceLoginRateLimit,
  resetLoginRateLimitsForTests,
} from '../routes/auth.js';

const runRateLimit = ({ ip = '203.0.113.10', identity = 'user@example.com' } = {}) => {
  const req = {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
    body: { email: identity },
  };
  const result = { status: null, body: null, next: false, headers: {} };
  const res = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  enforceLoginRateLimit(req, res, () => {
    result.next = true;
  });
  return result;
};

test('login rate limit blocks repeated attempts for one identity', () => {
  resetLoginRateLimitsForTests();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(runRateLimit().next, true);
  }
  const blocked = runRateLimit();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.message, 'Too many login attempts');
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  resetLoginRateLimitsForTests();
});

test('login IP limit cannot be bypassed by rotating usernames', () => {
  resetLoginRateLimitsForTests();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(runRateLimit({ identity: `rotated-${attempt}@example.com` }).next, true);
  }
  const blocked = runRateLimit({ identity: 'rotated-final@example.com' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.message, 'Too many login attempts');
  resetLoginRateLimitsForTests();
});
