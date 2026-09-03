import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guestSecurityActor,
  issueGuestBarSession,
  verifyGuestBarSession,
} from '../utils/guestBarAccess.js';

const withAccessEnvironment = (work) => {
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    pin: process.env.PUBLIC_BAR_RETURNS_PIN,
    version: process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION,
  };
  process.env.JWT_SECRET = 'test-jwt-secret-with-enough-entropy';
  process.env.PUBLIC_BAR_RETURNS_PIN = '1216';
  process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION = '1';
  try { return work(); }
  finally {
    if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.JWT_SECRET;
    if (previous.pin === undefined) delete process.env.PUBLIC_BAR_RETURNS_PIN;
    else process.env.PUBLIC_BAR_RETURNS_PIN = previous.pin;
    if (previous.version === undefined) delete process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION;
    else process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION = previous.version;
  }
};

test('guest PIN exchange creates a scoped short-lived session', () => withAccessEnvironment(() => {
  const session = issueGuestBarSession();
  const payload = verifyGuestBarSession(session.token);
  assert.equal(payload.tokenType, 'guest-bar-returns');
  assert.equal(payload.sub, 'guest-bar-returns');
  assert.equal(session.expiresIn, 12 * 60 * 60);
}));

test('changing the PIN or access version revokes existing guest sessions', () => withAccessEnvironment(() => {
  const session = issueGuestBarSession();
  process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION = '2';
  assert.throws(() => verifyGuestBarSession(session.token), /revoked/i);
}));

test('security actor identifiers are stable but do not expose the IP', () => withAccessEnvironment(() => {
  const first = guestSecurityActor({ ip: '203.0.113.25' });
  const second = guestSecurityActor({ ip: '203.0.113.25' });
  assert.equal(first, second);
  assert.equal(first.includes('203.0.113.25'), false);
  assert.match(first, /^[a-f0-9]{16}$/);
}));
