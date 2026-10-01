import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/bar.js';

const callReturnsSession = (role) => {
  const layer = router.stack.find((entry) => entry.route?.path === '/returns-session' && entry.route.methods.post);
  const handlers = layer.route.stack.map((entry) => entry.handle);
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    const req = { auth: { userId: 'u1', role }, body: {} };
    const run = (index) => {
      if (index >= handlers.length) return resolve({ status: res.statusCode, passed: true });
      return handlers[index](req, res, () => run(index + 1));
    };
    run(0);
  });
};

test('only bar managers can open an unscoped Bar Returns session', async () => {
  for (const role of ['bar captain', 'bartender', 'captain']) {
    const result = await callReturnsSession(role);
    assert.equal(result.status, 403, role);
  }
  const previousPin = process.env.PUBLIC_BAR_RETURNS_PIN;
  const previousSecret = process.env.JWT_SECRET;
  process.env.PUBLIC_BAR_RETURNS_PIN = previousPin || '1234';
  process.env.JWT_SECRET = previousSecret || 'test-secret';
  try {
    const manager = await callReturnsSession('bar admin');
    assert.equal(manager.status, 200);
    assert.equal(typeof manager.body.sessionToken, 'string');
  } finally {
    if (previousPin === undefined) delete process.env.PUBLIC_BAR_RETURNS_PIN;
    else process.env.PUBLIC_BAR_RETURNS_PIN = previousPin;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
