import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS,
  createUserInviteToken,
  hashUserInviteToken,
  renderUserInviteEmail,
  sendUserInviteEmail,
  userInviteUrl,
} from '../utils/userInvitations.js';

test('captain invitation creates a hashed 72 hour one-time credential', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const invite = createUserInviteToken({ now });
  assert.notEqual(invite.token, invite.tokenHash);
  assert.equal(invite.tokenHash, hashUserInviteToken(invite.token));
  assert.equal(invite.expiresAt.getTime(), now + INVITE_TTL_MS);
});

test('captain invitation link uses the configured OCC frontend', () => {
  const previous = process.env.PUBLIC_APP_ORIGIN;
  process.env.PUBLIC_APP_ORIGIN = 'https://occdecks.com/';
  try {
    assert.equal(userInviteUrl('a token'), 'https://occdecks.com/accept-invite?token=a%20token');
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = previous;
  }
});

test('captain invitation explains registration and beverage returns', () => {
  const email = renderUserInviteEmail({ name: 'Test Captain', inviteUrl: 'https://occdecks.com/accept-invite?token=test' });
  assert.match(email.text, /create your password/i);
  assert.match(email.text, /returned quantities/i);
  assert.match(email.text, /Ivan/);
});

test('captain invitation email is sent from Ivan with a reply address', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  let request;
  try {
    const result = await sendUserInviteEmail({
      email: 'itsupport@ocnyc.com',
      name: 'Test Captain',
      inviteUrl: 'https://occdecks.com/accept-invite?token=test',
      fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ id: 'invite-email-1' }) };
      },
    });
    assert.equal(result.status, 'sent');
    assert.equal(request.body.from, 'Ivan at OCC <reports@reports.occdecks.com>');
    assert.equal(request.body.reply_to, 'ivan@ocnyc.com');
    assert.deepEqual(request.body.to, ['itsupport@ocnyc.com']);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});
