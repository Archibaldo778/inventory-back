import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import usersRouter from '../routes/users.js';
import authRouter from '../routes/auth.js';
import { allowDuplicateUserNames } from '../utils/userNameIndex.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, cookie() {}, setHeader() {} });
const handler = (router, path, method = 'post') => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const env = (t, key, value) => { const before = process.env[key]; process.env[key] = value; t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; }); };

const pendingLead = () => ({ _id: '507f1f77bcf86cd799439011', username: 'Zia Sheikh', email: 'lead@example.com', role: 'kitchen lead', isActive: false, inviteTokenHash: 'existing-invite', inviteExpiresAt: new Date('2027-01-01') });

test('create a second account with the same name and a different email without changing the pending lead', async (t) => {
  const lead = pendingLead(); const original = structuredClone(lead); let created;
  t.mock.method(User, 'findOne', async (query) => query.email === lead.email || query.username === lead.username ? lead : null);
  t.mock.method(User, 'create', async (payload) => {
    created = new User(payload); await created.validate(); return created;
  });
  const res = response();
  await handler(usersRouter, '/')({ auth: { role: 'super admin' }, body: { username: lead.username, email: ' ADMIN@EXAMPLE.COM ', role: 'kitchen admin', password: 'valid-password' } }, res);
  assert.equal(res.code, 201);
  assert.equal(res.body.username, lead.username);
  assert.equal(res.body.email, 'admin@example.com');
  assert.equal(res.body.role, 'kitchen admin');
  assert.equal(await bcrypt.compare('valid-password', created.password), true);
  assert.deepEqual(lead, original);
  const usernameIndexes = User.schema.indexes().filter(([key, options]) => key.username && options.unique);
  assert.equal(usernameIndexes.length, 0);
  assert.ok(User.schema.indexes().some(([key, options]) => key.email === 1 && options.unique));
  const duplicate = response();
  await handler(usersRouter, '/')({ auth: { role: 'admin' }, body: { username: 'Another name', email: lead.email, password: 'valid-password' } }, duplicate);
  assert.equal(duplicate.code, 409);
});

test('a same-name kitchen admin invitation uses its new email and preserves the original invitation', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  const lead = pendingLead(); const original = structuredClone(lead); let created; const deliveries = [];
  t.mock.method(User, 'findOne', (query) => ({ select: async () => query.email === lead.email ? lead : null }));
  t.mock.method(User, 'create', async (payload) => { created = { ...payload, save: async () => {} }; return created; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { deliveries.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'mock-email' }) }; });
  const res = response();
  await handler(usersRouter, '/invite')({ auth: { role: 'super admin' }, body: { username: lead.username, email: 'admin@example.com', role: 'kitchen admin' } }, res);
  assert.equal(res.code, 201);
  assert.equal(created.username, lead.username);
  assert.equal(created.role, 'kitchen admin');
  assert.notEqual(created.inviteTokenHash, lead.inviteTokenHash);
  assert.deepEqual(deliveries[0].to, ['admin@example.com']);
  assert.deepEqual(lead, original);
  const duplicate = response();
  await handler(usersRouter, '/invite')({ auth: { role: 'super admin' }, body: { username: lead.username, email: lead.email, role: 'kitchen admin' } }, duplicate);
  assert.equal(duplicate.code, 409);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(lead, original);
});

test('duplicate names require email login, each email gets its own role, and unique-name login still works', async (t) => {
  env(t, 'JWT_SECRET', 'test-duplicate-name-login-secret');
  const hash = await bcrypt.hash('valid-password', 4);
  const lead = { ...pendingLead(), isActive: true, password: hash };
  const admin = { ...lead, _id: '507f1f77bcf86cd799439012', email: 'admin@example.com', role: 'kitchen admin' };
  let matches = [lead, admin];
  t.mock.method(User, 'find', (query) => {
    assert.deepEqual(query, { username: lead.username });
    return { limit(count) { assert.equal(count, 2); return { select: async () => matches }; } };
  });
  t.mock.method(User, 'findOne', (query) => ({ select: async () => [lead, admin].find((user) => user.email === query.email) }));
  const login = async (body) => { const res = response(); await handler(authRouter, '/login')({ body }, res); return res; };
  const ambiguous = await login({ username: lead.username, password: 'valid-password' });
  assert.equal(ambiguous.code, 400);
  assert.match(ambiguous.body.message, /email address/);
  assert.equal(ambiguous.body.token, undefined);
  for (const user of [lead, admin]) {
    const res = await login({ email: user.email.toUpperCase(), password: 'valid-password' });
    assert.equal(res.code, 200);
    assert.equal(res.body.user.role, user.role);
    assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).sub, user._id);
  }
  lead.isActive = false;
  assert.equal((await login({ email: lead.email, password: 'valid-password' })).code, 403);
  assert.equal((await login({ email: admin.email, password: 'wrong-password' })).code, 401);
  matches = [admin];
  assert.equal((await login({ username: admin.username, password: 'valid-password' })).body.user.role, 'kitchen admin');
  matches = [];
  assert.equal((await login({ username: admin.username, password: 'valid-password' })).code, 401);
});

test('index migration changes only unique username indexes, is dry-run by default and preserves email uniqueness', async () => {
  let indexes = [{ name: '_id_', key: { _id: 1 } }, { name: 'username_1', key: { username: 1 }, unique: true }, { name: 'email_1', key: { email: 1 }, unique: true }, { name: 'team_names', key: { teamId: 1, username: 1 }, unique: true }];
  const collection = { listIndexes: () => ({ toArray: async () => indexes }), dropIndex: async (name) => { indexes = indexes.filter((index) => index.name !== name); } };
  assert.deepEqual(await allowDuplicateUserNames(collection), { apply: false, usernameIndexes: ['username_1'] });
  assert.equal(indexes.length, 4);
  await allowDuplicateUserNames(collection, { apply: true });
  assert.deepEqual(indexes.map((index) => index.name), ['_id_', 'email_1', 'team_names']);
  assert.deepEqual(await allowDuplicateUserNames(collection, { apply: true }), { apply: true, usernameIndexes: [] });
  for (const invalid of [{ unique: false }, { unique: true, sparse: true }, { unique: true, partialFilterExpression: { email: { $exists: true } } }]) {
    indexes = [{ name: 'username_1', key: { username: 1 }, unique: true }, { name: 'email_1', key: { email: 1 }, ...invalid }];
    await assert.rejects(allowDuplicateUserNames(collection, { apply: true }), /unique email index/);
    assert.equal(indexes.length, 2);
  }
});
