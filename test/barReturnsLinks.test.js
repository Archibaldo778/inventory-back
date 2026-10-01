import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarEventShareLink, verifyBarEventShareToken } from '../utils/barReturnsLinks.js';

process.env.JWT_SECRET ||= 'bar-returns-link-test-secret-that-is-long-enough';

test('bartender share link is reusable for its event until returns are submitted', () => {
  const previousOrigin = process.env.PUBLIC_APP_ORIGIN;
  process.env.PUBLIC_APP_ORIGIN = 'https://example.test/';
  try {
    const result = createBarEventShareLink({ dashboardEventId: 'event-a' });
    const parsed = new URL(result.url);
    const token = parsed.pathname.split('/').pop();
    assert.equal(parsed.origin, 'https://example.test');
    assert.match(parsed.pathname, /^\/bar\/r\/[A-Za-z0-9_-]{24}$/);
    assert.equal(verifyBarEventShareToken(token, result.tokenHash), true);
    assert.equal(verifyBarEventShareToken(token, result.tokenHash), true);
    assert.equal(verifyBarEventShareToken('another-token', result.tokenHash), false);
  } finally {
    if (previousOrigin === undefined) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = previousOrigin;
  }
});
