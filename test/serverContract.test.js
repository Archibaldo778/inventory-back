import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseHealth, notFoundHandler } from '../server.js';

test('health and not-found handlers return truthful JSON contracts', () => {
  const health = getDatabaseHealth();
  assert.deepEqual(health, {
    connected: false,
    statusCode: 503,
    database: 'unavailable',
  });

  const result = { status: null, body: null };
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
  notFoundHandler({}, res);
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { message: 'Route not found' });
});
