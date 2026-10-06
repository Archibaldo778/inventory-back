import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationReviewEmail, deliverRegistrationNotification, runRegistrationNotifications } from '../utils/registrationNotifications.js';

const now = new Date('2026-10-06T16:00:00Z');
const payload = { from: 'OCC <reports@example.com>', to: ['owner@example.com'], subject: 'New registration', text: 'Review this request.' };
const job = { _id: 'person@example.com', status: 'pending', notificationStatus: 'queued', notificationPayload: payload };
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (value instanceof Date) return +row[key] === +value;
  if (value && typeof value === 'object') return Object.entries(value).every(([op, limit]) => {
    if (op === '$in') return limit.includes(row[key]);
    if (op === '$gt') return row[key] > limit;
    if (op === '$lte') return row[key] <= limit;
    throw Error(op);
  });
  return row[key] === value;
});
const memory = (initial = [job]) => {
  const rows = structuredClone(initial); const calls = [];
  const Requests = {
    findOneAndUpdate(query, change) { return { select: async () => {
      const row = rows.find((item) => matches(item, query));
      if (!row) return null;
      Object.assign(row, structuredClone(change.$set)); return structuredClone(row);
    } }; },
    async updateOne(query, change) { const row = rows.find((item) => matches(item, query)); if (row) Object.assign(row, structuredClone(change.$set)); },
  };
  const fetchImpl = async (_url, options) => { calls.push({ key: options.headers['Idempotency-Key'], body: options.body }); return { ok: true, json: async () => ({ id: 'mail-1' }) }; };
  return { rows, calls, Requests, fetchImpl, apiKey: 'test-key', now };
};

test('review email contains escaped applicant details and an authenticated review link, never a password or activation token', (t) => {
  const before = process.env.REGISTRATION_REVIEW_EMAIL;
  process.env.REGISTRATION_REVIEW_EMAIL = 'owner@example.com';
  t.after(() => { if (before === undefined) delete process.env.REGISTRATION_REVIEW_EMAIL; else process.env.REGISTRATION_REVIEW_EMAIL = before; });
  const message = registrationReviewEmail({ name: '<img src=x onerror=alert(1)>', email: 'person+test@example.com', password: 'private-password', token: 'private-token' });
  assert.deepEqual(message.to, ['owner@example.com', 'iurie@ocnyc.com']); assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined);
  assert.match(message.html, /&lt;img/); assert.doesNotMatch(message.html, /<img/);
  const link = new URL(message.text.split('\n').find((line) => line.startsWith('https://') || line.startsWith('http://')));
  assert.equal(link.pathname, '/admin-users');
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('registration'), 'person+test@example.com');
  assert.doesNotMatch(JSON.stringify(message), /private-password|private-token/);
  process.env.REGISTRATION_REVIEW_EMAIL = 'one@example.com,two@example.com';
  assert.throws(() => registrationReviewEmail({ name: 'Person', email: job._id }), /One.*recipient/);
});

test('captain and kitchen requests notify both reviewers and copy only the selected department, without activation credentials', (t) => {
  const settings = { REGISTRATION_REVIEW_EMAIL: 'ivan@ocnyc.com', REGISTRATION_REVIEW_SECOND_EMAIL: 'iurie@ocnyc.com', REGISTRATION_REVIEW_STAFFING_EMAIL: 'staffing@ocnyc.com', REGISTRATION_REVIEW_KITCHEN_EMAIL: 'jerome@ocnyc.com' };
  for (const [key, value] of Object.entries(settings)) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  for (const [department, copy] of [['captain', 'staffing@ocnyc.com'], ['kitchen', 'jerome@ocnyc.com'], ['other', null]]) {
    const message = registrationReviewEmail({ name: 'Person', email: job._id, department, password: 'private-password', token: 'private-token' });
    assert.deepEqual(message.to, ['ivan@ocnyc.com', 'iurie@ocnyc.com']);
    assert.deepEqual(message.cc, copy ? [copy] : undefined);
    assert.doesNotMatch(JSON.stringify(message), /private-password|private-token|activate-account/);
  }
  process.env.REGISTRATION_REVIEW_SECOND_EMAIL = 'IVAN@ocnyc.com';
  process.env.REGISTRATION_REVIEW_STAFFING_EMAIL = 'ivan@ocnyc.com';
  const unique = registrationReviewEmail({ name: 'Person', email: job._id, department: 'captain' });
  assert.deepEqual(unique.to, ['ivan@ocnyc.com']); assert.equal(unique.cc, undefined);
});

test('concurrent notification attempts send once and a repeated request never re-mails a delivered notification', async () => {
  const store = memory();
  const statuses = await Promise.all([deliverRegistrationNotification(store), deliverRegistrationNotification(store)]);
  assert.deepEqual(statuses.sort(), ['idle', 'sent']);
  assert.equal(store.calls.length, 1); assert.equal(store.rows[0].notificationStatus, 'sent');
  assert.equal(await deliverRegistrationNotification({ ...store, now: new Date(+now + 86400_000) }), 'idle');
  assert.equal(store.calls.length, 1);
});

test('uncertain delivery retries the same persisted email and idempotency key, within the provider deduplication window only', async () => {
  const store = memory();
  const uncertain = async (url, options) => { await store.fetchImpl(url, options); throw Error('timeout after acceptance'); };
  assert.equal(await deliverRegistrationNotification({ ...store, fetchImpl: uncertain }), 'failed');
  assert.equal(await deliverRegistrationNotification(store), 'idle');
  assert.equal(await deliverRegistrationNotification({ ...store, now: new Date(+now + 5 * 60_000) }), 'sent');
  assert.deepEqual(store.calls[0], store.calls[1]);
  const expired = memory([{ ...job, notificationStatus: 'failed', notificationFirstAttemptAt: new Date(+now - 24 * 3600_000), notificationLockedUntil: new Date(+now - 60_000) }]);
  assert.equal(await deliverRegistrationNotification(expired), 'idle'); assert.equal(expired.calls.length, 0);
});

test('worker picks up an interrupted delivery but never backfills legacy requests or mails approved and rejected requests', async () => {
  const store = memory([
    { _id: 'legacy@example.com', status: 'pending' },
    { ...job, _id: 'approved@example.com', status: 'approved' },
    { ...job, _id: 'rejected@example.com', status: 'rejected' },
    { ...job, notificationStatus: 'processing', notificationFirstAttemptAt: new Date(+now - 60_000), notificationLockedUntil: new Date(+now - 1) },
  ]);
  await runRegistrationNotifications(store);
  assert.equal(store.calls.length, 1); assert.equal(store.rows.at(-1).notificationStatus, 'sent');
  assert.equal(store.rows[0].notificationStatus, undefined);
  assert.equal(await deliverRegistrationNotification({ ...store, apiKey: '' }), 'unconfigured');
});
