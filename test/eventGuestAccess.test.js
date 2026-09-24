import test from 'node:test';
import assert from 'node:assert/strict';
import { issueEventGuestAccess, verifyEventGuestAccess } from '../utils/eventGuestAccess.js';

process.env.JWT_SECRET ||= 'event-guest-access-test-secret-that-is-long-enough';

test('event guest tokens are scoped to one capability and listed events', () => {
  const token = issueEventGuestAccess({
    eventIds: ['event-a', 'event-b'],
    capability: 'operations:view',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(verifyEventGuestAccess(token, 'event-b', 'operations:view').capability, 'operations:view');
  assert.throws(() => verifyEventGuestAccess(token, 'event-c', 'operations:view'));
  assert.throws(() => verifyEventGuestAccess(token, 'event-a', 'bar:returns'));
});
