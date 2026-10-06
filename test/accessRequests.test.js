import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import AccessRequest from '../models/AccessRequest.js';
import User from '../models/Users.js';
import router, { publicAccessRequestRoutes, accessRequestLimit } from '../routes/accessRequests.js';
import { registrationDetails, requestRegistration, approveRegistration, activateRegistration, sendActivationEmail, reviewableRequests } from '../utils/accessRequests.js';
import { departmentAdminRequestAllowed } from '../utils/departmentAccess.js';

const now = new Date('2026-10-06T15:00:00Z');
const person = { name: 'Test Captain', email: 'captain@example.com', password: 'test-password-123' };
const auth = { role: 'staffing admin', userId: 'admin-1', username: 'Staffing', email: 'staffing@example.com' };
const matches = (row, query) => Boolean(row) && Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some((part) => matches(row, part));
  if (key === '$and') return value.every((part) => matches(row, part));
  if (value === null) return row[key] == null;
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, limit]) => {
    if (op === '$in') return limit.includes(row[key]);
    if (op === '$ne') return row[key] !== limit;
    if (op === '$type') return typeof row[key] === limit;
    if (op === '$lte') return row[key] <= limit;
    if (op === '$gt') return row[key] > limit;
    throw Error(`Unsupported operator ${op}`);
  });
  return row[key] === value;
});
const memory = () => {
  const requests = new Map(); const users = new Map(); const mails = []; const notifications = [];
  const update = (row, change) => { Object.assign(row, change.$set || {}); for (const key of Object.keys(change.$unset || {})) delete row[key]; };
  const Requests = {
    async updateOne(query, change, options = {}) {
      let row = [...requests.values()].find((item) => matches(item, query));
      const inserted = !row && options.upsert;
      if (!row && options.upsert) { row = { _id: query._id, ...structuredClone(change.$setOnInsert) }; requests.set(row._id, row); }
      if (row) update(row, structuredClone(change));
      return { matchedCount: row ? 1 : 0, upsertedCount: inserted ? 1 : 0 };
    },
    findOneAndUpdate(query, change) { return { select: async () => {
      const row = [...requests.values()].find((item) => matches(item, query));
      if (!row) return null; update(row, structuredClone(change)); return structuredClone(row);
    } }; },
  };
  const Users = { exists: async ({ email }) => users.has(email), create: async (row) => {
    if (users.has(row.email)) throw Object.assign(Error('Duplicate email'), { code: 11000 });
    users.set(row.email, structuredClone(row)); return row;
  } };
  return { Requests, Users, now, requests, users, mails, notifications, notify: async (email) => notifications.push(email), sendEmail: async (mail) => mails.push(mail) };
};
const response = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(body) { this.body = body; return this; } });
const handler = (r, path, method) => r.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

// Only in-memory models and stubbed email providers are used in these tests.
test('registration keeps a hashed password pending review and ignores public role fields and repeated submissions', async () => {
  const store = memory();
  await requestRegistration({ ...person, email: ' CAPTAIN@EXAMPLE.COM ', role: 'super admin', isActive: true }, store);
  const row = structuredClone(store.requests.get(person.email));
  assert.equal(row.status, 'pending'); assert.equal(row.role, undefined); assert.equal(row.password, undefined);
  assert.equal(await bcrypt.compare(person.password, row.passwordHash), true);
  assert.equal(store.users.size, 0); assert.equal(store.mails.length, 0);
  assert.deepEqual(store.notifications, [person.email]);
  assert.equal(row.notificationStatus, 'queued');
  assert.ok(!JSON.stringify(row.notificationPayload).includes(person.password));
  await requestRegistration({ ...person, name: 'Replacement', password: 'replacement-password' }, store);
  assert.deepEqual(store.requests.get(person.email), row);
  assert.deepEqual(store.notifications, [person.email]);
  store.users.set('existing@example.com', { password: 'existing-hash', role: 'admin' });
  await requestRegistration({ ...person, email: 'existing@example.com' }, store);
  assert.equal(store.requests.has('existing@example.com'), false);
  assert.deepEqual(store.users.get('existing@example.com'), { password: 'existing-hash', role: 'admin' });
});

test('approval and email possession are both required; activation uses the original password exactly once', async () => {
  const store = memory(); await requestRegistration(person, store);
  assert.equal(await activateRegistration('a'.repeat(64), person.password, store), false);
  await approveRegistration({ email: person.email, role: 'bar captain', auth }, store);
  assert.equal(store.users.size, 0); assert.equal(store.mails.length, 1);
  const mail = store.mails[0];
  assert.equal(mail.email, person.email); assert.deepEqual(mail.sender, auth);
  assert.notEqual(store.requests.get(person.email).activationHash, mail.token);
  assert.equal(await activateRegistration('b'.repeat(64), person.password, store), false);
  assert.equal(await activateRegistration(mail.token, person.password, { ...store, now: new Date(+now + 31 * 86400_000) }), false);
  assert.equal(await activateRegistration(mail.token, 'wrong-password', store), false);
  assert.equal(store.users.size, 0);
  assert.equal(await activateRegistration(mail.token, person.password, store), person.email);
  const user = store.users.get(person.email);
  assert.equal(user.role, 'bar captain'); assert.equal(user.isActive, true);
  assert.equal(await bcrypt.compare(person.password, user.password), true);
  assert.equal(store.requests.get(person.email).passwordHash, undefined);
  assert.equal(await activateRegistration(mail.token, person.password, store), false);
});

test('approval cannot escalate department roles, reapprove immediately or replace an existing account', async () => {
  const store = memory(); await requestRegistration(person, store);
  await assert.rejects(approveRegistration({ email: person.email, role: 'admin', auth }, store), /cannot approve/);
  await assert.rejects(approveRegistration({ email: person.email, role: 'captain', auth: { role: 'captain' } }, store), /cannot approve/);
  await approveRegistration({ email: person.email, role: 'captain', auth }, store);
  await assert.rejects(approveRegistration({ email: person.email, role: 'captain', auth }, store), /just processed/);
  assert.equal(store.mails.length, 1);
  store.users.set(person.email, { role: 'admin', password: 'existing-hash' });
  await assert.rejects(approveRegistration({ email: person.email, role: 'captain', auth }, store), /already has an account/);
  assert.equal(await activateRegistration(store.mails[0].token, person.password, store), false);
  assert.deepEqual(store.users.get(person.email), { role: 'admin', password: 'existing-hash' });
});

test('uncertain email delivery stays approved and usable without automatically sending again', async () => {
  const store = memory(); await requestRegistration(person, store);
  let token;
  await assert.rejects(approveRegistration({ email: person.email, role: 'captain', auth }, { ...store, sendEmail: async (mail) => { token = mail.token; throw Error('provider timeout'); } }), /provider timeout/);
  assert.equal(store.requests.get(person.email).status, 'approved');
  assert.equal(store.requests.get(person.email).emailSentAt, null);
  assert.equal(await activateRegistration(token, person.password, store), person.email);
});

test('rejection revokes activation and removes the password; reviewers cannot expose password hashes', async (t) => {
  const store = memory(); await requestRegistration(person, store);
  await approveRegistration({ email: person.email, role: 'captain', auth }, store);
  t.mock.method(AccessRequest, 'updateOne', store.Requests.updateOne);
  const res = response();
  await handler(router, '/:email/reject', 'post')({ params: { email: person.email }, auth }, res);
  assert.equal(res.code, 200); assert.equal(store.requests.get(person.email).passwordHash, undefined);
  assert.equal(await activateRegistration(store.mails[0].token, person.password, store), false);
  t.mock.method(AccessRequest, 'find', () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [{ _id: person.email, name: person.name, passwordHash: 'private', activationHash: 'secret' }] }));
  const listed = response(); await handler(router, '/', 'get')({ auth }, listed);
  assert.equal(listed.body.items[0].email, person.email);
  assert.doesNotMatch(JSON.stringify(listed.body), /private|secret|passwordHash|activationHash/);
});

test('registration routes reject malformed input, rate-limit requests and restrict reviews to administrators', async (t) => {
  for (const body of [{}, { ...person, email: 'invalid' }, { ...person, password: 'short' }, { ...person, password: 'x'.repeat(73) }]) assert.throws(() => registrationDetails(body));
  const guard = router.stack.find((layer) => !layer.route).handle;
  for (const role of ['captain', 'bar captain', 'kitchen admin', 'user']) { const res = response(); guard({ auth: { role } }, res, () => assert.fail('unauthorized review')); assert.equal(res.code, 403); }
  for (const role of ['admin', 'super admin', 'staffing admin']) { let allowed = false; guard({ auth: { role } }, response(), () => { allowed = true; }); assert.equal(allowed, true); }
  for (const method of ['GET', 'POST']) {
    const originalUrl = method === 'GET' ? '/api/users/access-requests' : '/api/users/access-requests/person%40example.com/approve';
    assert.equal(departmentAdminRequestAllowed(auth, { method, originalUrl }), true);
    assert.equal(departmentAdminRequestAllowed({ role: 'kitchen admin' }, { method, originalUrl }), false);
  }
  assert.equal(matches({ status: 'approved', role: 'admin' }, reviewableRequests(auth)), false);
  const request = response(); await handler(publicAccessRequestRoutes, '/request-access', 'post')({ body: { ...person, password: 'short' } }, request); assert.equal(request.code, 400);
  t.mock.method(User, 'create', () => assert.fail('public registration cannot create accounts'));
  accessRequestLimit.clear(); let allowed = 0; const limited = response();
  for (let i = 0; i < 11; i++) accessRequestLimit({ ip: 'test-ip' }, limited, () => { allowed++; });
  assert.equal(allowed, 10); assert.equal(limited.code, 429); accessRequestLimit.clear();
});

test('activation email goes only to the registrant, from the approving administrator, without the password', async () => {
  let body;
  const token = 'a'.repeat(64);
  await sendActivationEmail({ email: person.email, token, sender: auth, fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'mail-1' }) };
  } });
  assert.deepEqual(body.to, [person.email]); assert.equal(body.cc, undefined); assert.equal(body.bcc, undefined);
  assert.match(body.from, /Staffing at OCC/); assert.equal(body.reply_to, auth.email);
  assert.ok(body.text.includes(`/activate-account#token=${token}`));
  assert.ok(!body.text.includes(person.password));
});

test('a notification failure never discards the registration and a review link keeps the normal role scope', async (t) => {
  const store = memory();
  t.mock.method(console, 'error', () => {});
  await requestRegistration(person, { ...store, notify: async () => { throw Error('temporary outage'); } });
  assert.equal(store.requests.get(person.email).notificationStatus, 'queued');
  let query;
  t.mock.method(AccessRequest, 'find', (filter) => { query = filter; return { sort() { return this; }, limit() { return this; }, lean: async () => [] }; });
  const res = response();
  await handler(router, '/', 'get')({ auth, query: { email: ' CAPTAIN@EXAMPLE.COM ' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(query, { ...reviewableRequests(auth), _id: person.email });
});
