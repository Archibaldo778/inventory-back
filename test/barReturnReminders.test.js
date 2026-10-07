import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBarReturnCaptains, deliverBarReturnReminder } from '../utils/barReturnReminders.js';
import { requestAccessKeys } from '../utils/accessRolePolicy.js';
import router from '../routes/bar.js';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import User from '../models/Users.js';

const worker = (name, status = 'confirmed') => ({ name, status, email: `${name.toLowerCase()}@example.com` });
const shift = (position, workers) => ({ position, workers });
const event = { _id: '68c70548aea053de74d25b22', linkedEventId: '68c7047faea053de74d25b15', name: 'Dinner <NY>', eventDate: '2026-10-07', status: 'ready' };
const recipient = { id: 'captain-1', name: 'Captain One', email: 'captain@example.com' };
const sender = { userId: 'sam-account', username: 'Sam Rivers', email: 'sam@example.com' };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('returns choose the sole captain or all bar captains, excluding regular captains and duplicate shifts', () => {
  assert.deepEqual(selectBarReturnCaptains({ schedule: { shifts: [shift('Captain', [worker('Alex')])] } }).map((c) => c.name), ['Alex']);
  const schedule = { shifts: [shift('Captain', [worker('Alex')]), shift('Bar Captain', [worker('Jo'), worker('Pat')]), shift('Bar Captain', [worker('Jo')]), shift('Bar Captain', [worker('Cancelled', 'declined')])] };
  assert.deepEqual(selectBarReturnCaptains({ schedule }).map((c) => c.name), ['Jo', 'Pat']);
  assert.deepEqual(selectBarReturnCaptains({ schedule: { ...schedule, archived: true } }), []);
  assert.deepEqual(selectBarReturnCaptains({ schedule: { shifts: [] }, users: [{ _id: '1', role: 'captain', username: 'Old' }], assignedUserIds: ['1'] }), []);
});

test('missing recipient emails remain visible and ambiguous account names never choose a recipient', () => {
  const schedule = { shifts: [shift('Bar Captain', [{ name: 'Jo', status: 'confirmed' }])] };
  const users = [{ _id: '1', role: 'captain', username: 'Jo', email: 'one@example.com' }, { _id: '2', role: 'captain', username: 'Jo', email: 'two@example.com' }];
  assert.equal(selectBarReturnCaptains({ schedule, users })[0].email, '');
  assert.equal(selectBarReturnCaptains({ schedule, users: users.slice(0, 1) })[0].email, 'one@example.com');
});

test('reminders use the authenticated sender, one recipient and an event-scoped return link', async () => {
  let payload;
  let claim;
  const updates = [];
  const result = await deliverBarReturnReminder({ event, recipient, sender, apiKey: 'test',
    Reminder: { findOneAndUpdate: async (filter, update) => { claim = { filter, update }; return {}; }, updateOne: async (...args) => updates.push(args) },
    makeToken: (options) => { assert.deepEqual(options.eventIds, [event.linkedEventId]); assert.equal(options.capability, 'bar:returns'); return 'test-token'; },
    fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); assert.ok(options.headers['Idempotency-Key']); return { ok: true, json: async () => ({ id: 'sent-1' }) }; },
  });
  assert.equal(result.recipientName, recipient.name);
  assert.deepEqual(payload.to, [recipient.email]);
  assert.match(payload.from, /Sam Rivers at OCC/);
  assert.equal(payload.reply_to, sender.email);
  assert.match(payload.text, /Complete bar returns:/);
  assert.match(payload.text, /access=test-token/);
  assert.match(payload.html, /Dinner &lt;NY&gt;/);
  assert.equal(claim.update.$set.senderId, sender.userId);
  assert.equal(updates[0][1].$set.status, 'sent');
});

test('atomic claim prevents simultaneous or rapid repeat reminders; submitted returns send nothing', async () => {
  let claimed = false;
  let sends = 0;
  const options = { event, recipient, sender, apiKey: 'test', makeToken: () => 'test',
    Reminder: { findOneAndUpdate: async () => { if (claimed) throw Object.assign(new Error('duplicate'), { code: 11000 }); claimed = true; return {}; }, updateOne: async () => {} },
    fetchImpl: async () => { sends += 1; return { ok: true, json: async () => ({ id: 'sent' }) }; },
  };
  const results = await Promise.allSettled([deliverBarReturnReminder(options), deliverBarReturnReminder(options)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.statusCode, 429);
  await assert.rejects(deliverBarReturnReminder({ ...options, event: { ...event, status: 'submitted' } }), /already been submitted/);
  assert.equal(sends, 1);
});

test('uncertain provider failure is recorded without an automatic email retry', async () => {
  const updates = [];
  let calls = 0;
  await assert.rejects(deliverBarReturnReminder({ event, recipient, sender, apiKey: 'test', makeToken: () => 'test',
    Reminder: { findOneAndUpdate: async () => ({}), updateOne: async (_filter, update) => updates.push(update) },
    fetchImpl: async () => { calls += 1; throw new Error('Network failed'); },
  }), /Network failed/);
  assert.equal(calls, 1);
  assert.equal(updates[0].$set.status, 'failed');
});

test('reminder route rejects ordinary captains and enforces the send permission', () => {
  const route = router.stack.find((layer) => layer.route?.path === '/events/:id/return-captains/:captainId/remind').route;
  const res = response();
  let nextCalled = false;
  route.stack[0].handle({ auth: { role: 'captain' } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.ok(requestAccessKeys({ originalUrl: '/api/bar/events/abc/return-captains/def/remind', method: 'POST', auth: { role: 'bar admin' } }).includes('reports.send'));
});

test('the route rechecks assignments and rejects a forged recipient without sending', async (t) => {
  const originals = [BarEvent.findById, Event.findById, User.find];
  t.after(() => { [BarEvent.findById, Event.findById, User.find] = originals; });
  BarEvent.findById = async () => event;
  Event.findById = () => ({ select() { return this; }, lean: async () => ({ meta: { nowsta: { shifts: [shift('Captain', [worker('Alex')])] } } }) });
  User.find = () => ({ select() { return this; }, lean: async () => [] });
  const handler = router.stack.find((layer) => layer.route?.path === '/events/:id/return-captains/:captainId/remind').route.stack.at(-1).handle;
  const res = response();
  await handler({ params: { id: event._id, captainId: 'forged' }, auth: { role: 'bar admin', ...sender }, body: { email: 'other@example.com', sender: 'Ivan' } }, res);
  assert.equal(res.statusCode, 409);
});

test('sanitation captains never receive bar reminders and Captain - Bar takes priority over Floor', () => {
  const shifts = [shift('Captain - Floor', [worker('Alec')]), shift('Captain - Sanitation', [worker('Jonnathan')])];
  assert.deepEqual(selectBarReturnCaptains({ schedule: { shifts } }).map((c) => c.name), ['Alec']);
  shifts.push(shift('Captain - Bar', [worker('Jo'), worker('Pat')]));
  assert.deepEqual(selectBarReturnCaptains({ schedule: { shifts } }).map((c) => c.name), ['Jo', 'Pat']);
  assert.deepEqual(selectBarReturnCaptains({ schedule: { shifts: [shift('Sanitation Captain', [worker('Jonnathan')])] } }), []);
});
