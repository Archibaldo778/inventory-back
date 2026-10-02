import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';
import authRouter from '../routes/auth.js';
import { hashUserInviteToken, userInviteTokenQuery } from '../utils/userInvitations.js';
import { deliverUserInviteReminder, runUserInviteReminders } from '../utils/userInviteReminders.js';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-10-05T12:00:00Z');
const pendingUser = (extra = {}) => ({
  _id: '507f1f77bcf86cd799439011', username: 'Chef', email: 'chef@example.com', role: 'kitchen lead',
  isActive: false, inviteAcceptedAt: null, inviteTokenHash: hashUserInviteToken('original'),
  inviteExpiresAt: new Date(now.getTime() + 5 * HOUR), inviteSentAt: new Date(now.getTime() - 67 * HOUR),
  ...extra,
});

// In-memory model double executes the filters supplied to Mongo, including atomic claims.
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some((part) => matches(row, part));
  if (value === null) return row[key] == null;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).every(([operator, operand]) => {
      if (operator === '$in') return operand.includes(row[key]);
      if (operator === '$gt') return row[key] > operand;
      if (operator === '$lte') return row[key] <= operand;
      if (operator === '$ne') return operand === null ? row[key] != null : row[key] !== operand;
      if (operator === '$type') return typeof row[key] === operand;
      throw new Error(`Unsupported query operator ${operator}`);
    });
  }
  return row[key] === value;
});
const mockUsers = (t, rows) => {
  const chain = (value) => ({ select() { return this; }, limit() { return this; }, lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
  t.mock.method(User, 'find', (query) => chain(structuredClone(rows.filter((row) => matches(row, query)))));
  t.mock.method(User, 'findOne', (query) => chain(structuredClone(rows.find((row) => matches(row, query)) || null)));
  t.mock.method(User, 'exists', async (query) => rows.some((row) => matches(row, query)));
  const update = (query, change) => {
    const row = rows.find((item) => matches(item, query));
    if (!row) return null;
    Object.assign(row, change.$set);
    for (const [key, value] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + value;
    return structuredClone(row);
  };
  t.mock.method(User, 'findOneAndUpdate', (query, change) => chain(update(query, change)));
  t.mock.method(User, 'updateOne', async (query, change) => ({ modifiedCount: update(query, change) ? 1 : 0 }));
};
const configured = (t) => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; });
};
const delivered = async () => ({ ok: true, json: async () => ({ id: 'mock-delivery' }) });

test('only unaccepted delivered invitations in their last five hours get one reminder, including existing invites', async (t) => {
  configured(t);
  const rows = [
    pendingUser(),
    pendingUser({ _id: 'captain', role: 'captain', inviteExpiresAt: new Date(now.getTime() + HOUR) }),
    pendingUser({ _id: 'too-early', inviteExpiresAt: new Date(now.getTime() + 5 * HOUR + 1) }),
    pendingUser({ _id: 'expired', inviteExpiresAt: now }),
    pendingUser({ _id: 'old-expired', inviteExpiresAt: new Date(now.getTime() - 14 * 24 * HOUR) }),
    pendingUser({ _id: 'active', isActive: true }),
    pendingUser({ _id: 'accepted', inviteAcceptedAt: now }),
    pendingUser({ _id: 'undelivered', inviteSentAt: null }),
    pendingUser({ _id: 'already-attempted', inviteReminderAttemptedAt: now }),
    pendingUser({ _id: 'no-token', inviteTokenHash: '' }),
    pendingUser({ _id: 'admin', role: 'admin' }),
  ];
  mockUsers(t, rows);
  const messages = [];
  const fetchImpl = async (_url, options) => { messages.push(JSON.parse(options.body)); return delivered(); };
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl }), { sent: 2, failed: 0, skipped: 0 });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].to, ['chef@example.com']);
  assert.equal(messages[0].cc, undefined);
  assert.match(messages[0].text, /New York time/);
  assert.doesNotMatch(messages[0].text, /72 hours|Captain’s Report|alcohol/);
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl }), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(messages.length, 2);
});

test('concurrent workers claim only once and preserve original link and expiration', async (t) => {
  configured(t);
  const user = pendingUser(); const original = structuredClone(user);
  mockUsers(t, [user]);
  let calls = 0; let token;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const message = JSON.parse(options.body);
    token = new URL(message.text.match(/Create my account: (\S+)/)[1]).searchParams.get('token');
    assert.ok(options.headers['Idempotency-Key']);
    return delivered();
  };
  const result = await Promise.all([deliverUserInviteReminder({ user: original, now, fetchImpl }), deliverUserInviteReminder({ user: original, now, fetchImpl })]);
  assert.deepEqual(result.sort(), ['sent', 'skipped']);
  assert.equal(calls, 1);
  assert.equal(user.inviteTokenHash, original.inviteTokenHash);
  assert.equal(user.inviteExpiresAt.getTime(), original.inviteExpiresAt.getTime());
  assert.equal(user.inviteReminderTokenHash, hashUserInviteToken(token));
  assert.ok(matches(user, userInviteTokenQuery('original', now)));
  assert.ok(matches(user, userInviteTokenQuery(token, now)));
  assert.ok(!matches(user, userInviteTokenQuery('wrong-token', now)));
  assert.ok(!matches(user, userInviteTokenQuery(token, user.inviteExpiresAt)));
});

test('registration or replacement invitation after discovery stops reminder delivery', async (t) => {
  configured(t);
  const user = pendingUser(); const candidate = structuredClone(user);
  mockUsers(t, [user]);
  user.inviteTokenHash = hashUserInviteToken('replacement');
  const fetchImpl = async () => { assert.fail('Must not send a stale reminder'); };
  assert.equal(await deliverUserInviteReminder({ user: candidate, now, fetchImpl }), 'skipped');
  candidate.inviteTokenHash = user.inviteTokenHash;
  t.mock.method(User, 'exists', async () => { user.isActive = true; user.inviteAcceptedAt = now; return false; });
  assert.equal(await deliverUserInviteReminder({ user: candidate, now, fetchImpl }), 'skipped');
});

test('uncertain network delivery is recorded without retrying or extending the invitation', async (t) => {
  configured(t);
  const user = pendingUser(); const expiry = user.inviteExpiresAt.getTime();
  mockUsers(t, [user]);
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('connection lost after sending'); };
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl }), { sent: 0, failed: 1, skipped: 0 });
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl }), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(calls, 1);
  assert.ok(user.inviteReminderError);
  assert.equal(user.inviteReminderSentAt, undefined);
  assert.equal(user.inviteExpiresAt.getTime(), expiry);
});

test('missing email configuration leaves invitations available for a later reminder', async (t) => {
  configured(t);
  delete process.env.RESEND_API_KEY;
  const user = pendingUser();
  mockUsers(t, [user]);
  const fetchImpl = async () => { assert.fail('No provider request without configuration'); };
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl }), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(user.inviteReminderAttemptedAt, undefined);
  process.env.RESEND_API_KEY = 'test-key';
  assert.deepEqual(await runUserInviteReminders({ now, fetchImpl: delivered }), { sent: 1, failed: 0, skipped: 0 });
});

test('expired and active invitations cannot be previewed or accepted through either link', async (t) => {
  const handler = (method) => authRouter.stack.find((entry) => entry.route?.path === (method === 'get' ? '/invitations/:token' : '/invitations/:token/accept') && entry.route.methods[method]).route.stack.at(-1).handle;
  for (const extra of [{ inviteExpiresAt: new Date(Date.now() - HOUR) }, { isActive: true }]) {
    const user = pendingUser({ inviteExpiresAt: new Date(Date.now() + HOUR), inviteReminderTokenHash: hashUserInviteToken('reminder'), ...extra });
    mockUsers(t, [user]);
    for (const token of ['original', 'reminder']) {
      for (const method of ['get', 'post']) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
        await handler(method)({ params: { token }, body: { password: 'new-password-123' } }, res);
        assert.equal(res.code, 404);
      }
    }
    assert.equal(user.password, undefined);
    t.mock.restoreAll();
  }
});

test('both invitation links can register once and activation revokes both tokens', async (t) => {
  const route = (path, method) => authRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
  const res = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
  for (const token of ['original', 'reminder']) {
    const user = pendingUser({ inviteExpiresAt: new Date(Date.now() + HOUR), inviteReminderTokenHash: hashUserInviteToken('reminder') });
    mockUsers(t, [user]);
    for (const link of ['original', 'reminder']) {
      const preview = res();
      await route('/invitations/:token', 'get')({ params: { token: link } }, preview);
      assert.equal(preview.code, 200);
      assert.equal(preview.body.email, user.email);
    }
    const accepted = res();
    await route('/invitations/:token/accept', 'post')({ params: { token }, body: { password: 'new-password-123' } }, accepted);
    assert.equal(accepted.code, 200);
    assert.equal(user.isActive, true);
    assert.equal(user.inviteTokenHash, '');
    assert.equal(user.inviteReminderTokenHash, '');
    assert.equal(user.tokenVersion, 1);
    assert.ok(await bcrypt.compare('new-password-123', user.password));
    for (const link of ['original', 'reminder']) {
      const repeat = res();
      await route('/invitations/:token/accept', 'post')({ params: { token: link }, body: { password: 'other-password' } }, repeat);
      assert.equal(repeat.code, 404);
    }
    t.mock.restoreAll();
  }
});
