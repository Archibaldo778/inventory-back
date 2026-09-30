import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarEventShareLink } from '../utils/barReturnsLinks.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';

process.env.JWT_SECRET ||= 'bar-returns-link-test-secret-that-is-long-enough';

test('bartender share link grants bar returns access to exactly one event for 72 hours', () => {
  const previousOrigin = process.env.PUBLIC_APP_ORIGIN;
  process.env.PUBLIC_APP_ORIGIN = 'https://example.test/';
  try {
    const now = new Date('2026-09-30T12:00:00.000Z');
    const result = createBarEventShareLink({ dashboardEventId: 'event-a', issuerId: 'captain-1', now });
    const parsed = new URL(result.url);
    const token = parsed.searchParams.get('access');
    assert.equal(parsed.origin, 'https://example.test');
    assert.equal(parsed.searchParams.get('event'), 'event-a');
    assert.equal(result.expiresAt, '2026-10-03T12:00:00.000Z');
    assert.equal(verifyEventGuestAccess(token, 'event-a', 'bar:returns').context, 'captain-share');
    assert.throws(() => verifyEventGuestAccess(token, 'event-b', 'bar:returns'));
    assert.throws(() => verifyEventGuestAccess(token, 'event-a', 'operations:view'));
  } finally {
    if (previousOrigin === undefined) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = previousOrigin;
  }
});
