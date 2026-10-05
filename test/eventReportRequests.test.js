import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import EventReportReminder from '../models/EventReportReminder.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import User from '../models/Users.js';
import router from '../routes/eventReports.js';
import { buildEventReportRequests, cancelEventReportRequest } from '../utils/eventReportRequests.js';
import { assignedReportCaptains, deliverCaptainReportReminder } from '../utils/captainReportReminders.js';

const eventId = '507f1f77bcf86cd799439001';
const userId = '507f1f77bcf86cd799439002';
const reportId = '507f1f77bcf86cd799439003';
const user = { _id: userId, username: 'Alex', email: 'alex@example.com', role: 'captain' };
const bartender = { ...user, _id: '507f1f77bcf86cd799439004', username: 'Sam', email: 'sam@example.com' };
const event = { _id: eventId, title: 'Dinner', date: '2026-10-04', meta: { nowsta: { apiEventId: '123' } } };
const schedule = { nowstaEventId: '123', shifts: [user, bartender].map((person, i) => ({ position: i ? 'Bartender' : 'Working Captain', workers: [{ name: person.username, email: person.email, status: 'confirmed' }] })) };
const query = (data) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => data });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const context = (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', () => query(schedule));
  t.mock.method(User, 'find', () => query([user, bartender]));
};

test('preview shows booked captain accounts before any report exists and uses event position, not account role', () => {
  const items = buildEventReportRequests({ event, schedule, users: [user, bartender], reports: [] });
  assert.equal(items.length, 2);
  assert.equal(items[0].status, 'pending');
  assert.equal(items[0].eventPosition, 'Working Captain');
  assert.equal(items[0].canCancelRequest, true);
  assert.equal(items[0].planned, true);
  assert.equal(items[1].eventPosition, 'Bartender');
  assert.equal(items[1].status, 'not_required');
  assert.equal(items[1].canCancelRequest, false);
});

test('previews reuse existing emailed/Slack/submitted requests without duplicates and show changed bookings', () => {
  const submitted = { _id: reportId, reportType: 'captain', reporterEmail: user.email, status: 'submitted', position: 'Captain' };
  const oldRequest = { ...submitted, _id: 'old', reporterEmail: bartender.email, status: 'pending' };
  const items = buildEventReportRequests({ event, schedule, users: [user, bartender], reports: [submitted, oldRequest] });
  assert.equal(items.length, 2);
  assert.equal(items[0].canCancelRequest, false);
  assert.equal(items[1].eventPosition, 'Bartender');
  assert.equal(items[1].canCancelRequest, true);
  assert.equal(oldRequest.position, 'Captain');
});

test('removed/unconfirmed workers and cancelled events do not become future report requests', () => {
  for (const status of ['declined', 'pending', 'removed']) {
    const changed = { shifts: [{ position: 'Captain', workers: [{ email: user.email, status }] }] };
    assert.deepEqual(buildEventReportRequests({ event, schedule: changed, users: [user], reports: [] }), []);
  }
  assert.deepEqual(buildEventReportRequests({ event, schedule: { ...schedule, archived: true }, users: [user], reports: [] }), []);
  for (const title of ['Tasting', 'Walk through', 'Load in', 'Load out']) {
    assert.equal(buildEventReportRequests({ event: { ...event, title }, schedule, users: [user], reports: [] })[0].status, 'not_required');
  }
});

test('every Captain position requires a report on either side of the reminder rollout without emailing historical events', async () => {
  for (const position of ['Captain', 'Captain - Floor', 'Captain - Expeditor', 'Captain - Bar', 'Floor Captain', 'BAR-CAPTAIN']) {
    for (const date of ['2026-09-30', '2026-10-01', '2026-10-04']) {
      const currentEvent = { ...event, date };
      const currentSchedule = { ...schedule, date, endsAt: new Date(`${date}T20:00:00-04:00`), shifts: [{ position, workers: [{ name: user.username, email: user.email, status: 'confirmed' }] }] };
      const [request] = buildEventReportRequests({ event: currentEvent, schedule: currentSchedule, users: [user], reports: [] });
      assert.equal(request.status, 'pending', `${position} on ${date}`);
      assert.equal(request.canCancelRequest, true);
      assert.equal(request.requirementReason, '');
      assert.equal(request.eventPosition, position);
      assert.deepEqual(assignedReportCaptains(currentSchedule, [user]), [user]);
      if (date < '2026-10-01') {
        assert.match(request.reminderNote, /October 1, 2026/);
        assert.equal(await deliverCaptainReportReminder({ event: currentEvent, schedule: currentSchedule, user, report: request,
          hours: 24, now: new Date(currentSchedule.endsAt.getTime() + 24 * 3600000), fetchImpl: () => assert.fail('Must not send historical reminders') }), 'skipped');
      } else assert.equal(request.reminderNote, '');
    }
  }
  const [waiter] = buildEventReportRequests({ event: { ...event, date: '2026-09-30' }, schedule: { shifts: [{ position: 'VIP Waiter', workers: [{ email: user.email, status: 'confirmed' }] }] }, users: [user], reports: [] });
  assert.equal(waiter.status, 'not_required');
  assert.equal(waiter.requirementReason, 'Not booked as a Captain on this event.');
});

test('opening/refreshing reports only reads assignments and cannot create reports or send mail', async (t) => {
  context(t);
  t.mock.method(Event, 'findById', () => query(event));
  t.mock.method(EventReport, 'find', () => query([]));
  t.mock.method(EventReportFile, 'find', () => query([]));
  t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('Read must not create a report'));
  t.mock.method(EventReportReminder, 'updateOne', () => assert.fail('Read must not schedule mail'));
  t.mock.method(globalThis, 'fetch', () => assert.fail('Read must not send mail'));
  for (let i = 0; i < 2; i++) {
    const res = response(); await handler('/', 'get')({ query: { eventId } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].reminderCount, 0);
  }
});

test('cancelling a preview persists the cancellation without creating a notification', async (t) => {
  context(t);
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { eventId, slackUserId: `account:${userId}` });
    assert.equal(update.$setOnInsert.status, 'cancelled');
    assert.equal(update.$setOnInsert.position, 'Working Captain');
    assert.equal(update.$setOnInsert.cancelledBy, 'admin');
    return { _id: reportId, ...update.$setOnInsert };
  });
  t.mock.method(EventReportReminder, 'updateMany', async (filter) => {
    assert.equal(filter.reportId, reportId);
    assert.deepEqual(filter.status.$in, ['pending', 'failed']);
  });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Cancel must not send email'));
  const report = await cancelEventReportRequest({ event, userId, actor: 'admin' });
  const items = buildEventReportRequests({ event, schedule, users: [user], reports: [report] });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'cancelled');
  assert.equal(items[0].canCancelRequest, false);
});

test('cancellation is scoped to event, preserves answers and cannot overwrite a submitted report', async (t) => {
  const report = { _id: reportId, status: 'pending', answers: { overallFeedback: 'Draft' } };
  t.mock.method(EventReport, 'findOne', async (filter) => { assert.equal(filter.eventId, eventId); return report; });
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: reportId, status: 'pending' });
    assert.equal(update.$set.answers, undefined); return null; // submission won the race
  });
  await assert.rejects(cancelEventReportRequest({ event, reportId, actor: 'admin' }), { statusCode: 409 });
  report.status = 'submitted';
  await assert.rejects(cancelEventReportRequest({ event, reportId, actor: 'admin' }), { statusCode: 409 });
  assert.equal(report.answers.overallFeedback, 'Draft');
});
