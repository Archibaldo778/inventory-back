import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportReminder from '../models/EventReportReminder.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import User from '../models/Users.js';
import {
  assignedReportCaptains, captainReminderEmail, captainReportReminderStage,
  deliverCaptainReportReminder, runCaptainReportEmailReminders,
} from '../utils/captainReportReminders.js';
import { openCaptainReport } from '../utils/captainReports.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';
import { runSlackEventReportReminders } from '../utils/slackEventChannels.js';

const HOUR = 3600000;
const endsAt = new Date('2026-10-02T02:00:00Z');
const at = (hours) => new Date(endsAt.getTime() + hours * HOUR);
const user = { _id: '507f1f77bcf86cd799439001', username: 'Test Captain', email: 'captain@example.com', role: 'captain', isActive: true };
const event = { _id: '507f1f77bcf86cd799439002', title: 'Dinner <One>', date: '2026-10-01', meta: { nowsta: { apiEventId: '123' } } };
const schedule = { nowstaEventId: '123', endsAt, date: event.date, shifts: [{ position: 'Captain', workers: [{ name: user.username, email: user.email, status: 'confirmed' }] }] };
const reportId = '507f1f77bcf86cd799439003';
const env = (t, key, value) => {
  const old = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
};
const setup = (t) => {
  env(t, 'JWT_SECRET', 'reminder-test-secret');
  env(t, 'RESEND_API_KEY', 'test-key');
  env(t, 'EVENT_REPORT_REMINDER_FROM', undefined);
  env(t, 'EVENT_REPORT_REMINDER_REPLY_TO', undefined);
  t.mock.timers.enable({ apis: ['Date'], now: at(24) });
  const state = { report: null, deliveries: new Map(), requests: [], submitted: false, users: [user], events: [event], schedules: [schedule] };
  t.mock.method(NowstaScheduleEntry, 'find', (query) => {
    assert.equal(query.archived.$ne, true);
    return { select: () => ({ lean: async () => state.schedules.filter((row) => !row.archived && row.endsAt >= query.endsAt.$gte && row.endsAt <= query.endsAt.$lte) }) };
  });
  t.mock.method(User, 'find', (query) => {
    assert.deepEqual(query.role.$in, ['captain', 'bar captain']);
    assert.equal(query.isActive.$ne, false);
    return { select: () => ({ lean: async () => state.users }) };
  });
  t.mock.method(Event, 'find', (query) => {
    assert.equal(query['meta.nowsta.excluded'].$ne, true);
    assert.equal(query['meta.eventReportTest'].$ne, true);
    return { select: () => ({ lean: async () => state.events.filter((row) => !query.status.$not.test(row.status || '') && !row.meta?.nowsta?.excluded && !row.meta?.eventReportTest) }) };
  });
  t.mock.method(EventReport, 'findOne', (query) => {
    assert.equal(query.reportType, 'captain');
    assert.equal(query.eventId, event._id);
    return { sort: async () => state.report };
  });
  t.mock.method(EventReport, 'findOneAndUpdate', async (_query, update) => {
    state.report ||= { _id: reportId, ...update.$setOnInsert };
    return state.report;
  });
  t.mock.method(EventReport, 'exists', () => state.submitted);
  t.mock.method(EventReport, 'updateOne', async (_query, update) => {
    Object.assign(state.report, update.$set);
    state.report.reminderCount = (state.report.reminderCount || 0) + update.$inc.reminderCount;
  });
  t.mock.method(EventReportReminder, 'findById', (id) => ({ select: () => ({ lean: async () => structuredClone(state.deliveries.get(id) || null) }) }));
  t.mock.method(EventReportReminder, 'updateOne', async (query, update) => {
    let row = state.deliveries.get(query._id);
    if (!row && update.$setOnInsert) { row = { _id: query._id, ...structuredClone(update.$setOnInsert) }; state.deliveries.set(query._id, row); }
    if (row && update.$set && (!query.status?.$ne || row.status !== query.status.$ne)) Object.assign(row, update.$set);
  });
  t.mock.method(EventReportReminder, 'findOneAndUpdate', async (query, update) => {
    const row = state.deliveries.get(query._id);
    assert.deepEqual(query.status.$in, ['pending', 'failed']);
    assert.deepEqual(query.$or[0], { lockedUntil: null });
    if (!row || !query.status.$in.includes(row.status) || row.firstAttemptAt <= query.firstAttemptAt.$gt
      || (row.lockedUntil && row.lockedUntil > query.$or[1].lockedUntil.$lte)) return null;
    Object.assign(row, update.$set);
    return structuredClone(row);
  });
  state.fetch = async (_url, options) => {
    state.requests.push({ headers: options.headers, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ id: `email-${state.requests.length}` }) };
  };
  state.run = (hours) => { t.mock.timers.setTime(at(hours).getTime()); return runCaptainReportEmailReminders({ now: at(hours), fetchImpl: state.fetch }); };
  return state;
};

test('reminders are due exactly 24, 36 and 48 elapsed hours after event end, including DST', () => {
  for (const [hours, stage] of [[0, null], [23.999, null], [24, 24], [35.999, 24], [36, 36], [47.999, 36], [48, 48], [72, 48]]) {
    assert.equal(captainReportReminderStage(endsAt, at(hours)), stage);
  }
  assert.equal(captainReportReminderStage(null, at(48)), null);
  assert.equal(captainReportReminderStage('invalid', at(48)), null);
  assert.equal(captainReportReminderStage('2026-11-01T00:00:00-04:00', new Date('2026-11-01T23:00:00-05:00')), 24);
});

test('only active assigned captains receive reminders, with exact email or full-name matching', () => {
  assert.deepEqual(assignedReportCaptains(schedule, [user, { ...user, role: 'bar captain' }]).length, 2);
  for (const changed of [{ isActive: false }, { role: 'event staff' }, { email: 'other@example.com' }, { email: '' }]) {
    assert.deepEqual(assignedReportCaptains(schedule, [{ ...user, ...changed }]), []);
  }
  assert.deepEqual(assignedReportCaptains({ ...schedule, shifts: [{ workers: [{ email: user.email, status: 'declined' }] }] }, [user]), []);
  assert.equal(assignedReportCaptains({ ...schedule, shifts: [{ workers: [{ name: user.username, status: 'confirmed' }] }] }, [user]).length, 1);
});

test('a never-opened report receives exactly three emails, with a working report link and Staffing reply address', async (t) => {
  const state = setup(t);
  assert.equal((await state.run(23.999)).sent, 0);
  for (const hour of [24, 36, 48]) {
    assert.equal((await state.run(hour)).sent, 1);
    assert.equal((await state.run(hour + 0.1)).sent, 0);
  }
  assert.equal((await state.run(72)).sent, 0);
  assert.equal(state.requests.length, 3);
  assert.equal(state.report.reminderCount, 3);
  assert.equal(state.report.eventEndsAt.getTime(), endsAt.getTime());
  for (const request of state.requests) {
    assert.deepEqual(request.body.to, [user.email]);
    assert.equal(request.body.from, 'Staffing and Service Department <reports@reports.occdecks.com>');
    assert.equal(request.body.reply_to, 'staffing@ocnyc.com');
    assert.match(request.body.html, /Dinner &lt;One&gt;/);
    assert.match(request.body.text, /48 hours after the event ends/);
    assert.match(request.body.text, /October 3, 2026 at 10:00 PM/);
    const url = new URL(request.body.text.match(/Complete your report: (\S+)/)[1]);
    assert.equal(verifyEventGuestAccess(url.searchParams.get('access'), event._id, 'event:report').subjectId, state.report.slackUserId);
  }
  assert.match(state.requests[2].body.subject, /Final reminder/);
});

test('submission stops later reminders, including reports already submitted through Slack', async (t) => {
  const state = setup(t);
  await state.run(24);
  state.report.status = 'submitted';
  state.report.slackUserId = 'slack-captain';
  assert.equal((await state.run(36)).sent, 0);
  assert.equal((await state.run(48)).sent, 0);
  assert.equal(state.requests.length, 1);
  assert.equal((await openCaptainReport({ event, user })).slackUserId, 'slack-captain');
});

test('submission immediately before sending cancels the claimed reminder', async (t) => {
  const state = setup(t);
  state.submitted = true;
  assert.equal((await state.run(24)).sent, 0);
  assert.equal(state.requests.length, 0);
  assert.equal([...state.deliveries.values()][0].status, 'cancelled');
});

test('failed delivery retries the same payload and idempotency key without duplicating successful sends', async (t) => {
  const state = setup(t);
  const success = state.fetch;
  state.fetch = async (...args) => { await success(...args); throw new Error('connection lost'); };
  assert.equal((await state.run(24)).failed, 1);
  assert.equal((await state.run(24.01)).sent, 0);
  state.fetch = success;
  assert.equal((await state.run(24.1)).sent, 1);
  assert.deepEqual(state.requests[0], state.requests[1]);
  assert.equal((await state.run(24.2)).sent, 0);
});

test('overlapping workers claim a delivery only once; uncertain deliveries cannot retry after idempotency expiry', async (t) => {
  const state = setup(t);
  const report = await openCaptainReport({ event, user, schedule });
  const args = { event, schedule, user, report, hours: 48, now: at(48), fetchImpl: state.fetch };
  const results = await Promise.all([deliverCaptainReportReminder(args), deliverCaptainReportReminder(args)]);
  assert.deepEqual(results.sort(), ['sent', 'skipped']);
  assert.equal(state.requests.length, 1);
  const delivery = [...state.deliveries.values()][0];
  delivery.status = 'failed';
  assert.equal(await deliverCaptainReportReminder({ ...args, now: at(72) }), 'skipped');
  assert.equal(state.requests.length, 1);
});

test('catch-up sends only the latest stage and skips cancelled, excluded, test, archived and ambiguously linked events', async (t) => {
  const state = setup(t);
  assert.equal((await state.run(49)).sent, 1);
  assert.equal(state.requests.length, 1);
  assert.match(state.requests[0].headers['Idempotency-Key'], /:48$/);
  state.deliveries.clear();
  for (const events of [[{ ...event, status: 'cancelled' }], [{ ...event, meta: { nowsta: { apiEventId: '123', excluded: true } } }], [{ ...event, meta: { ...event.meta, eventReportTest: true } }], [event, { ...event, _id: 'duplicate' }]]) {
    state.events = events;
    assert.equal((await state.run(49)).sent, 0);
  }
  state.events = [event];
  state.schedules = [{ ...schedule, archived: true }];
  assert.equal((await state.run(49)).sent, 0);
  assert.equal(state.requests.length, 1);
});

test('captain reminders work without Slack and no longer enter the Slack daily reminder query', async (t) => {
  const state = setup(t);
  env(t, 'SLACK_BOT_TOKEN', undefined);
  assert.equal((await state.run(24)).sent, 1);
  env(t, 'SLACK_BOT_TOKEN', 'test-slack-token');
  env(t, 'SLACK_EVENT_REPORTS_ENABLED', 'true');
  t.mock.method(EventReport, 'find', (query) => {
    assert.equal(query.reportType, 'kitchen');
    return { sort: () => ({ limit: async () => [] }) };
  });
  t.mock.method(Event, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  assert.equal((await runSlackEventReportReminders()).sent, 0);
});
