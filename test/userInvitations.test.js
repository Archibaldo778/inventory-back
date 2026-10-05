import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS,
  createUserInviteToken,
  hashUserInviteToken,
  isExistingActiveInviteAccount,
  normalizeInviteCc,
  renderUserInviteEmail,
  sendUserInviteEmail,
  userInviteUrl,
} from '../utils/userInvitations.js';

test('a new email is not mistaken for an existing active captain account', () => {
  assert.equal(isExistingActiveInviteAccount(null), false);
  assert.equal(isExistingActiveInviteAccount(undefined), false);
  assert.equal(isExistingActiveInviteAccount({ isActive: false }), false);
  assert.equal(isExistingActiveInviteAccount({ isActive: true }), true);
  assert.equal(isExistingActiveInviteAccount({}), true);
});

test('captain invitation creates a hashed 30 day one-time credential', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const invite = createUserInviteToken({ now });
  assert.notEqual(invite.token, invite.tokenHash);
  assert.equal(invite.tokenHash, hashUserInviteToken(invite.token));
  assert.equal(invite.expiresAt.getTime(), now + INVITE_TTL_MS);
  assert.equal(invite.expiresAt.toISOString(), '2026-10-30T12:00:00.000Z');
});

test('all invitation templates explain the 30 day deadline only for new accounts', () => {
  for (const role of ['captain', 'bar captain', 'kitchen lead', 'uniform packer']) {
    const pending = renderUserInviteEmail({ name: 'Staff', role, inviteUrl: 'https://example.com/invite' });
    assert.match(pending.text, /expires in 30 days/);
    assert.match(pending.html, /expires in 30 days/);
    assert.doesNotMatch(pending.text, /72 hours/);
    const active = renderUserInviteEmail({ name: 'Staff', role, active: true, inviteUrl: 'https://example.com/login' });
    assert.doesNotMatch(active.text, /expires in/);
    assert.match(active.text, /existing password/);
  }
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

test('bar captain invitation explains registration, reports and beverage returns', () => {
  const email = renderUserInviteEmail({ name: 'Test Captain', role: 'bar captain', inviteUrl: 'https://occdecks.com/accept-invite?token=test' });
  assert.match(email.text, /create your password/i);
  assert.match(email.text, /Sent, Received and Returned quantities/);
  assert.match(email.text, /Captain’s Report/);
  assert.match(email.text, /Submit Captain’s Report separately/);
  assert.match(email.text, /Ivan/);
});

test('report-only captain instructions never ask for bar returns', () => {
  const email = renderUserInviteEmail({ name: '<Captain>', role: 'captain', inviteUrl: 'https://example.com/invite' });
  assert.match(email.subject, /event reporting system/);
  assert.match(email.text, /Captain’s Report/);
  assert.doesNotMatch(email.text, /Bar Returns|beverage|returned quantities/i);
  assert.match(email.html, /&lt;Captain&gt;/);
});

test('invitation subject and body describe only the systems each recipient uses without assigning a job title', () => {
  for (const role of ['captain', 'bar captain']) {
    for (const active of [false, true]) {
      const email = renderUserInviteEmail({ name: 'Alex', role, active, inviteUrl: 'https://example.com/start' });
      const barAccess = role === 'bar captain';
      const introduction = barAccess
        ? 'We are introducing a new system for tracking alcohol inventory and completing event reports at OCC.'
        : 'We are introducing a new system for completing event reports at OCC.';
      assert.equal(email.subject, barAccess
        ? 'OCC — new alcohol inventory and event reporting system'
        : 'OCC — new event reporting system');
      assert.ok(email.text.includes(introduction));
      assert.ok(email.html.includes(introduction));
      for (const content of [email.subject, email.text, email.html]) {
        if (barAccess) assert.match(content, /alcohol inventory/);
        else assert.doesNotMatch(content, /alcohol|inventory|beverage|bar returns|returned quantities/i);
      }
      assert.doesNotMatch(`${email.subject}\n${email.text}\n${email.html}`, /your OCC position|bar captain|captain account/i);
    }
  }
});

test('active captains get sign-in instructions without a new password or expiration', () => {
  const email = renderUserInviteEmail({ name: 'Captain', role: 'bar captain', active: true, inviteUrl: 'https://example.com/login' });
  assert.match(email.text, /existing password/);
  assert.doesNotMatch(email.text, /72 hours|Create your password/);
  assert.match(email.html, />Sign in</);
});

test('invitation CC addresses are validated, normalized and deduplicated', () => {
  assert.deepEqual(normalizeInviteCc(' Manager@Example.com; manager@example.com, copy@example.com '), ['manager@example.com', 'copy@example.com']);
  assert.deepEqual(normalizeInviteCc(), []);
  assert.throws(() => normalizeInviteCc('invalid'), /valid CC/);
  assert.throws(() => normalizeInviteCc(Array.from({ length: 6 }, (_, i) => `copy${i}@example.com`)), /up to 5/);
});

test('captain invitation email is sent from Ivan with a reply address', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  let request;
  const requests = [];
  try {
    const result = await sendUserInviteEmail({
      email: 'itsupport@ocnyc.com',
      name: 'Test Captain',
      role: 'captain',
      cc: ['copy@example.com', 'itsupport@ocnyc.com'],
      inviteUrl: 'https://occdecks.com/accept-invite?token=test',
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        request = requests[0];
        return { ok: true, json: async () => ({ id: 'invite-email-1' }) };
      },
    });
    assert.equal(result.status, 'sent');
    assert.equal(request.body.from, 'Ivan at OCC <reports@reports.occdecks.com>');
    assert.equal(request.body.reply_to, 'ivan@ocnyc.com');
    assert.deepEqual(request.body.to, ['itsupport@ocnyc.com']);
    assert.equal(request.body.cc, undefined);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body.to, ['copy@example.com']);
    assert.match(request.body.text, /accept-invite\?token=test/);
    assert.doesNotMatch(JSON.stringify(requests[1].body), /accept-invite|token=|https:\/\/occdecks/);
    assert.match(requests[1].body.text, /Invitation sent to Test Captain/);
    assert.doesNotMatch(request.body.text, /Bar Returns/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});
