import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/users.js';
import User from '../models/Users.js';

const handler = (path, method) => (req, res) => router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack[0].handle({ auth: { role: 'admin' }, ...req }, res);
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('admin preview provides report and uniform packing invitation templates', () => {
  const res = response();
  handler('/invite-templates', 'get')({}, res);
  const templates = Object.fromEntries(res.body.map((entry) => [entry.role, entry]));
  assert.ok(templates['kitchen lead']);
  assert.ok(templates['kitchen admin']);
  assert.ok(templates['staffing admin']);
  assert.ok(templates.admin);
  assert.equal(templates['super admin'], undefined);
  assert.doesNotMatch(templates.captain.text, /Bar Returns/);
  assert.match(templates['bar captain'].text, /Bar Returns/);
  assert.match(templates['uniform packer'].text, /Staff & Uniform/);
  assert.doesNotMatch(templates['uniform packer'].text, /Captain’s Report|Bar Returns|alcohol/);
});

test('invitation rejects invalid role and CC before creating an account', async () => {
  for (const extra of [{ role: 'invalid-role' }, { cc: 'bad-address' }]) {
    const res = response();
    await handler('/invite', 'post')({ body: { username: 'Test', email: 'test@example.com', ...extra } }, res);
    assert.equal(res.code, 400);
  }
});

test('invitation creates captains and preserves credentials of active bar captains', async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  });
  let existing = null;
  let created;
  let outgoing;
  let saves = 0;
  t.mock.method(User, 'findOne', () => ({ select: async () => existing }));
  t.mock.method(User, 'create', async (payload) => {
    created = { ...payload, save: async () => { saves += 1; } };
    return created;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    outgoing = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 'test-delivery' }) };
  });
  const res = response();
  await handler('/invite', 'post')({ body: { username: 'Test', email: 'test@example.com', role: 'captain', cc: 'copy@example.com' } }, res);
  assert.equal(res.code, 201);
  assert.equal(created.role, 'captain');
  assert.equal(created.isActive, false);
  assert.ok(created.inviteTokenHash);
  assert.ok(created.inviteSentAt);
  assert.equal(created.inviteReminderAttemptedAt, null);
  assert.equal(created.inviteReminderTokenHash, '');
  assert.equal(saves, 2);
  assert.doesNotMatch(outgoing.text, /Bar Returns/);
  assert.deepEqual(outgoing.to, ['copy@example.com']);
  assert.equal(outgoing.cc, undefined);
  assert.doesNotMatch(outgoing.text, /accept-invite|token=/);

  existing = { username: 'Test', email: 'test@example.com', role: 'captain', isActive: true, password: 'unchanged-hash', tokenVersion: 7, inviteAcceptedAt: new Date(), save: async () => {} };
  const accepted = existing.inviteAcceptedAt;
  const activeRes = response();
  await handler('/invite', 'post')({ body: { username: 'Test', email: 'test@example.com', role: 'bar captain' } }, activeRes);
  assert.equal(activeRes.code, 201);
  assert.equal(existing.role, 'captain');
  assert.equal(existing.isActive, true);
  assert.equal(existing.password, 'unchanged-hash');
  assert.equal(existing.tokenVersion, 7);
  assert.equal(existing.inviteAcceptedAt, accepted);
  assert.match(outgoing.text, /existing password/);
  assert.doesNotMatch(outgoing.text, /Bar Returns/);
  assert.match(outgoing.text, /Captain’s Report/);
});

test('failed delivery is reported and does not record a sent invitation', async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() => { if (previousKey !== undefined) process.env.RESEND_API_KEY = previousKey; });
  const existing = { role: 'captain', isActive: false, inviteSentAt: new Date(), inviteReminderAttemptedAt: new Date(), inviteReminderSentAt: new Date(), inviteReminderTokenHash: 'old-reminder', save: async () => {} };
  t.mock.method(User, 'findOne', () => ({ select: async () => existing }));
  const res = response();
  await handler('/invite', 'post')({ body: { username: 'Test', email: 'test@example.com', role: 'captain' } }, res);
  assert.equal(res.code, 502);
  assert.equal(existing.inviteSentAt, null);
  assert.equal(existing.inviteReminderTokenHash, '');
  assert.equal(existing.inviteReminderAttemptedAt, null);
  assert.equal(existing.inviteReminderSentAt, null);
});

test('captain invitation cannot replace an account with another role', async (t) => {
  t.mock.method(User, 'findOne', () => ({ select: async () => ({ role: 'admin', isActive: true }) }));
  const res = response();
  await handler('/invite', 'post')({ body: { username: 'Test', email: 'test@example.com', role: 'captain' } }, res);
  assert.equal(res.code, 409);
});

test('uniform invitation creates an inactive packer with its own instructions and rejects cross-role replacements', async (t) => {
  const key = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key; });
  let existing = null; let created; let outgoing;
  t.mock.method(User, 'findOne', () => ({ select: async () => existing }));
  t.mock.method(User, 'create', async (payload) => { created = { ...payload, save: async () => {} }; return created; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { outgoing = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'test' }) }; });
  const res = response();
  await handler('/invite', 'post')({ body: { username: 'Packer', email: 'packer@example.com', role: 'uniform packer' } }, res);
  assert.equal(res.code, 201);
  assert.equal(created.role, 'uniform packer');
  assert.equal(created.isActive, false);
  assert.ok(created.inviteTokenHash);
  assert.match(outgoing.text, /Staff & Uniform/);
  assert.doesNotMatch(outgoing.text, /Captain’s Report|Bar Returns/);
  existing = { role: 'captain', isActive: true };
  const rejected = response();
  await handler('/invite', 'post')({ body: { username: 'Captain', email: 'captain@example.com', role: 'uniform packer' } }, rejected);
  assert.equal(rejected.code, 409);
});
