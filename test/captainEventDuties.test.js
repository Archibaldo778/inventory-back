import test from 'node:test';
import assert from 'node:assert/strict';
import { captainEventDuties, loadCaptainEventDutiesBatch } from '../utils/captainEventDuties.js';
import { assignedReportCaptains, deliverCaptainReportReminder } from '../utils/captainReportReminders.js';
import { openCaptainReport } from '../utils/captainReports.js';
import router, { canOperateEvent } from '../routes/bar.js';
import publicRouter from '../routes/publicEventReports.js';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import EventReport from '../models/EventReport.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import User from '../models/Users.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';

const eventId = '507f1f77bcf86cd799439001';
const barId = '507f1f77bcf86cd799439002';
const userId = '507f1f77bcf86cd799439003';
const user = { _id: userId, userId, username: 'Test Captain', email: 'captain@example.com', role: 'bar captain' };
const worker = { name: user.username, email: user.email, status: 'confirmed' };
const schedule = (position) => ({ nowstaEventId: 'n1', title: 'Dinner', date: '2026-10-01', shifts: [{ position, workers: [worker] }] });
const event = { _id: eventId, title: 'Dinner', date: '2026-10-01', meta: { nowsta: { apiEventId: 'n1', shifts: schedule('Captain').shifts } } };
const handler = (routes, path, method) => routes.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('event duties use the confirmed booking position, not the account role or another worker’s shift', () => {
  for (const role of ['captain', 'bar captain']) {
    for (const position of ['Bartender', 'Server', 'Barback', '']) {
      const current = { ...user, role };
      assert.equal(captainEventDuties({ event, schedule: schedule(position), user: current }).captainAssigned, false);
      assert.deepEqual(assignedReportCaptains(schedule(position), [current]), []);
    }
    for (const position of ['Captain', 'Bar Captain', 'Lead Captain', 'BAR-CAPTAIN']) {
      assert.equal(captainEventDuties({ event, schedule: schedule(position), user: { ...user, role } }).captainAssigned, true);
      assert.equal(assignedReportCaptains(schedule(position), [{ ...user, role }]).length, 1);
    }
  }
  const mixed = schedule('Bartender');
  mixed.shifts.push({ position: 'Captain', workers: [{ ...worker, email: 'other@example.com' }, { ...worker, status: 'declined' }] });
  assert.deepEqual(captainEventDuties({ event, schedule: mixed, user }), { captainAssigned: false, positions: ['Bartender'] });
  mixed.shifts.push({ position: 'Captain', workers: [{ ...worker, status: 'assigned' }] });
  assert.equal(captainEventDuties({ event, schedule: mixed, user }).captainAssigned, true);
  assert.equal(captainEventDuties({ event, schedule: { ...mixed, archived: true }, user }).captainAssigned, false);
  assert.equal(captainEventDuties({ event: { meta: { nowsta: { shifts: schedule('Bartender').shifts } } }, user }).captainAssigned, false);
  assert.equal(captainEventDuties({ event: {}, user }).captainAssigned, true);
});

test('captains booked as bartenders do not create reports or receive any of the three reminder stages', async (t) => {
  t.mock.method(EventReport, 'findOne', () => assert.fail('must not create or reopen a report'));
  for (const hours of [24, 36, 48]) {
    assert.equal(await deliverCaptainReportReminder({ event, user, schedule: schedule('Bartender'), hours, fetchImpl: () => assert.fail('must not send email') }), 'skipped');
  }
  await assert.rejects(openCaptainReport({ event, user, schedule: schedule('Bartender') }), { statusCode: 403 });
});

test('a bartender booking stays visible but cannot open a captain report, share returns or mutate alcohol counts; a new captain booking restores access', async (t) => {
  let booking = schedule('Bartender');
  const barEvent = { _id: barId, linkedEventId: eventId, assignedUserIds: [userId], items: [], audit: [], name: 'Dinner' };
  t.mock.method(BarEvent, 'findById', async () => barEvent);
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => event }) }));
  t.mock.method(NowstaScheduleEntry, 'findOne', (filter) => {
    assert.equal(filter.nowstaEventId, 'n1');
    return { select: () => ({ lean: async () => booking }) };
  });
  const req = { params: { id: barId }, auth: user, body: {} };
  const visible = response();
  await handler(router, '/events/:id', 'get')(req, visible);
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.body.canUseCaptainReport, false);
  assert.equal(visible.body.canOperateBar, false);
  assert.equal(visible.body.reportRequired, false);
  assert.deepEqual(visible.body.bookingPositions, ['Bartender']);
  for (const [path, method] of [['/events/:id/captain-report-link', 'post'], ['/events/:id/share-link', 'post'], ['/events/:id/returns', 'patch'], ['/events/:id/items/:itemId/return', 'patch']]) {
    const res = response();
    await handler(router, path, method)(req, res);
    assert.equal(res.statusCode, 403, path);
  }
  assert.equal(canOperateEvent(barEvent, user), false);
  assert.equal(canOperateEvent(barEvent, { role: 'bar admin' }), true);
  booking = schedule('Captain');
  const captain = response();
  await handler(router, '/events/:id', 'get')(req, captain);
  assert.equal(captain.body.canUseCaptainReport, true);
  assert.equal(captain.body.canOperateBar, true);
  assert.equal(canOperateEvent(barEvent, user), true);
  const reportOnly = response();
  await handler(router, '/events/:id', 'get')({ ...req, auth: { ...user, role: 'captain' } }, reportOnly);
  assert.equal(reportOnly.body.canUseCaptainReport, true);
  assert.equal(reportOnly.body.canOperateBar, false);
  booking = schedule('Bartender');
  const changedAgain = response();
  await handler(router, '/events/:id', 'get')(req, changedAgain);
  assert.equal(changedAgain.body.canUseCaptainReport, false);
});

test('event cards resolve different booking positions for the same captain in a single schedule query', async (t) => {
  const lookup = t.mock.method(NowstaScheduleEntry, 'find', (query) => {
    assert.deepEqual(query, { nowstaEventId: { $in: ['n1', 'n2'] } });
    return { select: () => ({ lean: async () => [schedule('Bartender'), { ...schedule('Captain'), nowstaEventId: 'n2' }] }) };
  });
  const result = await loadCaptainEventDutiesBatch([event, { ...event, _id: barId, meta: { nowsta: { apiEventId: 'n2' } } }], user);
  assert.equal(result.get(eventId).captainAssigned, false);
  assert.deepEqual(result.get(eventId).positions, ['Bartender']);
  assert.equal(result.get(barId).captainAssigned, true);
  assert.equal(lookup.mock.callCount(), 1);
});

test('an earlier personal report link cannot require or submit a report after reassignment to bartender', async (t) => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'booking-test-secret';
  t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => event }) }));
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => user }) }));
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => schedule('Bartender') }) }));
  t.mock.method(EventReport, 'findOne', async () => ({ _id: barId, eventId, reportType: 'captain', slackUserId: `account:${userId}`, status: 'pending', save: () => assert.fail('must not save') }));
  const access = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: `account:${userId}` });
  const req = { params: { eventId }, query: { access }, body: { answers: {} } };
  const loaded = response();
  await handler(publicRouter, '/:eventId', 'get')(req, loaded);
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.body.report.reportRequired, false);
  const submitted = response();
  await handler(publicRouter, '/:eventId', 'post')(req, submitted);
  assert.equal(submitted.statusCode, 403);
});
