import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticatedActorRateKey,
  createMemoryRateLimiter,
} from '../middleware/rateLimit.js';

const run = (limiter, overrides = {}) => {
  const req = {
    method: 'POST',
    ip: '203.0.113.20',
    socket: { remoteAddress: '203.0.113.20' },
    auth: { userId: '507f1f77bcf86cd799439011' },
    ...overrides,
  };
  const result = { status: null, next: false, headers: {} };
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
  limiter(req, res, () => {
    result.next = true;
  });
  return result;
};

test('authenticated rate keys isolate users and include the network address', () => {
  assert.equal(
    authenticatedActorRateKey({ auth: { userId: 'user-1' }, ip: '203.0.113.5' }),
    'user-1:203.0.113.5'
  );
});

test('memory rate limiter blocks only after the configured allowance', () => {
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(run(limiter).next, true);
  assert.equal(run(limiter).next, true);
  const blocked = run(limiter);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['RateLimit-Remaining'], '0');
  limiter.clear();
});

test('safe requests can be excluded from mutation rate limits', () => {
  const limiter = createMemoryRateLimiter({ windowMs: 60_000, max: 1, skipSafeMethods: true });
  assert.equal(run(limiter, { method: 'GET' }).next, true);
  assert.equal(run(limiter).next, true);
  assert.equal(run(limiter).status, 429);
  limiter.clear();
});
