import AccessRole from '../models/AccessRole.js';
AccessRole.findById = () => ({ select: () => ({ lean: async () => null }) });
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { requireAuth } from '../middleware/auth.js';
import authRouter from '../routes/auth.js';
import resetRouter, { resetRequestIpLimit, resetRequestEmailLimit, resetSubmitLimit } from '../routes/passwordReset.js';
import { requestPasswordReset, completePasswordReset, hashPasswordResetToken, passwordResetValidation,
  sendPasswordResetEmail, passwordResetUrl, PASSWORD_RESET_TTL_MS, PASSWORD_RESET_MESSAGE } from '../utils/passwordReset.js';

const now = new Date('2026-10-02T15:00:00Z');
const baseUser = { _id: '507f1f77bcf86cd799439011', email: 'person@example.com', username: 'Person', role: 'captain', isActive: true,
  tokenVersion: 0, password: 'old-password-hash', permissions: { inventoryRead: true }, teamId: 'team-1' };
const expression = (value, row) => {
  if (typeof value === 'string' && value.startsWith('$')) return row[value.slice(1)];
  if (value?.$ifNull) return expression(value.$ifNull[0], row) ?? value.$ifNull[1];
  if (value?.$eq) return expression(value.$eq[0], row) === expression(value.$eq[1], row);
  if (value?.$and) return value.$and.every((entry) => expression(entry, row));
  return value;
};
const matches = (row, query) => row && Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some((entry) => matches(row, entry));
  if (key === '$expr') return expression(value, row);
  if (value === null) return row[key] == null;
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, limit]) => {
    if (op === '$ne') return row[key] !== limit;
    if (op === '$gt') return row[key] > limit;
    if (op === '$lte') return row[key] <= limit;
    throw new Error(`Unsupported test query ${op}`);
  });
  return row[key] === value;
});
const memoryUsers = (initial = baseUser) => {
  const user = initial ? structuredClone(initial) : null;
  return { user, Users: {
    findOne(query) { return { select: async () => matches(user, query) ? structuredClone(user) : null }; },
    findOneAndUpdate(query, update) {
      const found = matches(user, query);
      if (found) {
        Object.assign(user, update.$set);
        for (const [key, amount] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + amount;
      }
      return { select: async () => found ? structuredClone(user) : null };
    },
  } };
};
const issue = async (store, options = {}) => {
  const emails = [];
  await requestPasswordReset(baseUser.email, { Users: store.Users, now, sendEmail: async (mail) => emails.push(mail), ...options });
  return emails;
};
const response = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; },
  setHeader(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; },
  cookie() {}, clearCookie(name, options) { this.cleared = { name, options }; } });
const handler = (router, path) => router.stack.find((layer) => layer.route?.path === path).route.stack.at(-1).handle;

test('every supported role can recover their own account without changing role, team or permissions', async () => {
  for (const role of User.schema.path('role').enumValues) {
    const store = memoryUsers({ ...baseUser, role });
    const [mail] = await issue(store);
    assert.equal(mail.email, baseUser.email);
    assert.equal(store.user.password, baseUser.password);
    assert.equal(store.user.passwordResetHash, hashPasswordResetToken(mail.token));
    assert.notEqual(store.user.passwordResetHash, mail.token);
    assert.equal(+store.user.passwordResetExpiresAt - now, PASSWORD_RESET_TTL_MS);
    assert.equal(await completePasswordReset(mail.token, 'a new password', { Users: store.Users, now }), true);
    assert.equal(await bcrypt.compare('a new password', store.user.password), true);
    assert.equal(store.user.role, role);
    assert.equal(store.user.teamId, baseUser.teamId);
    assert.deepEqual(store.user.permissions, baseUser.permissions);
    assert.equal(store.user.tokenVersion, 1);
    assert.equal(store.user.passwordResetHash, '');
    assert.equal(await completePasswordReset(mail.token, 'replay password', { Users: store.Users, now }), false);
  }
});

test('parallel requests mail once across workers; concurrent resets consume the token only once', async () => {
  const store = memoryUsers();
  const results = await Promise.all([issue(store), issue(store)]);
  assert.equal(results.flat().length, 1);
  const { token } = results.flat()[0];
  const resets = await Promise.all([
    completePasswordReset(token, 'new password one', { Users: store.Users, now }),
    completePasswordReset(token, 'new password two', { Users: store.Users, now }),
  ]);
  assert.equal(resets.filter(Boolean).length, 1);
  assert.equal(store.user.tokenVersion, 1);
});

test('unknown and inactive accounts get no email; reset never enables an inactive user', async () => {
  for (const user of [null, { ...baseUser, isActive: false }]) assert.deepEqual(await issue(memoryUsers(user)), []);
  const store = memoryUsers(); const [mail] = await issue(store);
  store.user.isActive = false;
  assert.equal(await completePasswordReset(mail.token, 'new password', { Users: store.Users, now }), false);
  assert.equal(store.user.password, baseUser.password); assert.equal(store.user.isActive, false);
});

test('expired, replaced and invalid links cannot reset a password or survive account changes', async () => {
  for (const patch of [{ passwordResetExpiresAt: now }, { tokenVersion: 1 }, { email: 'different@example.com' }]) {
    const store = memoryUsers(); const [mail] = await issue(store);
    Object.assign(store.user, patch);
    assert.equal(await completePasswordReset(mail.token, 'new password', { Users: store.Users, now }), false);
    assert.equal(store.user.password, baseUser.password);
  }
  const store = memoryUsers(); const [old] = await issue(store);
  const [fresh] = await issue(store, { now: new Date(+now + 61_000) });
  assert.notEqual(old.token, fresh.token);
  assert.equal(await completePasswordReset(old.token, 'new password', { Users: store.Users, now }), false);
  assert.equal(await completePasswordReset('bad token', 'new password', { Users: store.Users, now }), false);
  assert.equal(await completePasswordReset(fresh.token, 'new password', { Users: store.Users, now }), true);
});

test('older accounts without tokenVersion can reset; unsupported password sizes are rejected', async () => {
  const initial = { ...baseUser }; delete initial.tokenVersion;
  const store = memoryUsers(initial); const [mail] = await issue(store);
  for (const password of ['', 'short', 'x'.repeat(73), '😀'.repeat(19)]) {
    assert.ok(passwordResetValidation(password));
    assert.equal(await completePasswordReset(mail.token, password, { Users: store.Users, now }), false);
  }
  assert.equal(await completePasswordReset(mail.token, '😀'.repeat(18), { Users: store.Users, now }), true);
  assert.equal(store.user.tokenVersion, 1);
});

test('new password signs in while old password, access token and refresh token are rejected', async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-recovery-only';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const store = memoryUsers({ ...baseUser, password: await bcrypt.hash('old password', 10) });
  const [mail] = await issue(store);
  await completePasswordReset(mail.token, 'new password', { Users: store.Users, now });
  t.mock.method(User, 'findOne', store.Users.findOne);
  t.mock.method(User, 'findById', () => ({ select: () => ({ ...store.user, lean: async () => store.user }) }));
  const oldLogin = response();
  await handler(authRouter, '/login')({ body: { email: baseUser.email, password: 'old password' } }, oldLogin);
  assert.equal(oldLogin.code, 401);
  const newLogin = response();
  await handler(authRouter, '/login')({ body: { email: baseUser.email, password: 'new password' } }, newLogin);
  assert.equal(newLogin.code, 200); assert.ok(newLogin.body.token);
  const oldAccess = jwt.sign({ sub: baseUser._id, tokenType: 'access', tokenVersion: 0 }, process.env.JWT_SECRET);
  const guarded = response();
  await requireAuth({ headers: { authorization: `Bearer ${oldAccess}` } }, guarded, () => assert.fail('Old access survived reset'));
  assert.equal(guarded.code, 401);
  const oldRefresh = jwt.sign({ sub: baseUser._id, tokenType: 'refresh', tokenVersion: 0 }, process.env.JWT_SECRET);
  const refreshed = response();
  await handler(authRouter, '/refresh')({ headers: { cookie: `rt=${oldRefresh}` } }, refreshed);
  assert.equal(refreshed.code, 401); assert.equal(refreshed.body.message, 'Session has been revoked');
});

test('public request returns the same response before account lookup or email delivery', async (t) => {
  const key = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 'test';
  t.after(() => { if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key; });
  for (const user of [baseUser, { ...baseUser, isActive: false }, null]) {
    const store = memoryUsers(user); const res = response();
    const mocked = t.mock.method(User, 'findOne', (query) => {
      assert.equal(res.code, 202); assert.equal(res.body.message, PASSWORD_RESET_MESSAGE);
      assert.equal(query.email, baseUser.email);
      return store.Users.findOne(query);
    });
    const updated = t.mock.method(User, 'findOneAndUpdate', store.Users.findOneAndUpdate);
    const fetched = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ id: 'test-mail' }) }));
    await handler(resetRouter, '/forgot-password')({ body: { email: ' PERSON@EXAMPLE.COM ' }, headers: { host: 'attacker.invalid' } }, res);
    assert.equal(res.body.message, PASSWORD_RESET_MESSAGE);
    assert.equal(fetched.mock.callCount(), user?.isActive === true ? 1 : 0);
    mocked.mock.restore(); updated.mock.restore(); fetched.mock.restore();
  }
});

test('reset email contains a private expiring link to the configured app and no CC recipients', async (t) => {
  const origin = process.env.PUBLIC_APP_ORIGIN; process.env.PUBLIC_APP_ORIGIN = 'https://occ.example';
  t.after(() => { if (origin === undefined) delete process.env.PUBLIC_APP_ORIGIN; else process.env.PUBLIC_APP_ORIGIN = origin; });
  const token = 'a'.repeat(64); let payload;
  await sendPasswordResetEmail({ email: baseUser.email, token, fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'test-mail' }) };
  } });
  const link = new URL(passwordResetUrl(token));
  assert.equal(link.origin, 'https://occ.example'); assert.equal(link.pathname, '/reset-password');
  assert.equal(link.search, ''); assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'), token);
  assert.deepEqual(payload.to, [baseUser.email]); assert.equal(payload.cc, undefined); assert.equal(payload.bcc, undefined);
  assert.match(payload.text, /30 minutes/); assert.match(payload.text, /used once/);
  assert.ok(payload.html.includes(link.href));
});

test('uncertain provider delivery leaves the emailed link usable without immediate repeated mail', async () => {
  const store = memoryUsers(); let captured;
  await assert.rejects(issue(store, { sendEmail: async (mail) => { captured = mail; throw new Error('timeout'); } }), /timeout/);
  assert.deepEqual(await issue(store), []);
  assert.equal(await completePasswordReset(captured.token, 'new password', { Users: store.Users, now }), true);
});

test('recovery throttles an email across IPs and an IP across changing emails, independently of login', () => {
  for (const limiter of [resetRequestIpLimit, resetRequestEmailLimit, resetSubmitLimit]) limiter.clear();
  const run = (limiter, req) => { const res = response(); let allowed = false; limiter(req, res, () => { allowed = true; }); return { res, allowed }; };
  for (let i = 0; i < 3; i += 1) assert.equal(run(resetRequestEmailLimit, { ip: String(i), body: { email: baseUser.email } }).allowed, true);
  assert.equal(run(resetRequestEmailLimit, { ip: 'another', body: { email: 'PERSON@EXAMPLE.COM' } }).res.code, 429);
  for (const limiter of [resetRequestIpLimit, resetSubmitLimit]) {
    for (let i = 0; i < 20; i += 1) assert.equal(run(limiter, { ip: 'shared-ip', body: { email: `${i}@example.com` } }).allowed, true);
    assert.equal(run(limiter, { ip: 'shared-ip', body: { email: 'last@example.com' } }).res.code, 429);
  }
  for (const limiter of [resetRequestIpLimit, resetRequestEmailLimit, resetSubmitLimit]) limiter.clear();
});

test('public completion clears the refresh cookie and rejects replay without issuing a session', async (t) => {
  const store = memoryUsers(); const [mail] = await issue(store, { now: new Date() });
  t.mock.method(User, 'findOneAndUpdate', store.Users.findOneAndUpdate);
  const res = response(); const body = { token: mail.token, password: 'new password', role: 'super admin' };
  await handler(resetRouter, '/reset-password')({ body }, res);
  assert.equal(res.code, 200); assert.equal(res.body.ok, true); assert.equal(res.body.token, undefined);
  assert.equal(res.cleared.name, 'rt'); assert.equal(store.user.role, baseUser.role);
  const replay = response(); await handler(resetRouter, '/reset-password')({ body }, replay);
  assert.equal(replay.code, 400); assert.match(replay.body.message, /Request a new link/);
});
