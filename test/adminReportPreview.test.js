import test from 'node:test';
import assert from 'node:assert/strict';
import barRouter from '../routes/bar.js';
import reportRouter from '../routes/eventReports.js';
import { openCaptainReport } from '../utils/captainReports.js';
import { visibleEventReports } from '../utils/eventReportVisibility.js';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import User from '../models/Users.js';

const eventId = '6ab45d63486fd0363d1d0453';
const adminId = '507f1f77bcf86cd799439001';
const captainId = '507f1f77bcf86cd799439002';
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const query = (value) => ({ sort() { return this; }, select() { return this; }, limit() { return this; }, lean: async () => value });

test('admin report button opens event review without creating a personal request, signing a guest link or saving the event', async (t) => {
  t.mock.method(BarEvent, 'findById', async () => ({ linkedEventId: eventId, save: () => assert.fail('review must not write') }));
  t.mock.method(Event, 'findById', () => query({ _id: eventId, title: 'Prada Saks Day 1' }));
  t.mock.method(EventReport, 'findOne', () => assert.fail('review must not open a personal draft'));
  t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('review must not create a request'));
  for (const role of ['admin', 'super admin']) {
    const res = response();
    await handler(barRouter, '/events/:id/captain-report-link', 'post')({ params: { id: eventId }, auth: { role, userId: adminId } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { path: `/events/${eventId}?view=reports` });
    assert.equal(new URL(res.body.path, 'https://example.com').searchParams.has('access'), false);
  }
  const res = response();
  await handler(barRouter, '/events/:id/captain-report-link', 'post')({ params: { id: eventId }, auth: { role: 'bar admin', userId: adminId } }, res);
  assert.equal(res.statusCode, 403);
});

test('personal report creation rejects office roles even without Nowsta booking data', async (t) => {
  t.mock.method(EventReport, 'findOne', () => assert.fail('must reject before accessing personal reports'));
  for (const role of ['admin', 'super admin', 'bar admin', 'event staff']) {
    await assert.rejects(openCaptainReport({ event: { _id: eventId, title: 'Dinner' }, user: { role, userId: adminId } }), { statusCode: 403 });
  }
});

test('event report list hides the empty Ivan admin preview while retaining submitted, edited and explicitly requested reports', async (t) => {
  const emptyAdmin = { _id: 'preview', eventId, reportType: 'captain', status: 'pending', reporterName: 'Ivan', slackUserId: `account:${adminId}`, answers: {}, requestSentAt: null, lastReminderAt: null, reminderCount: 0 };
  const reports = [
    emptyAdmin,
    { ...emptyAdmin, _id: 'christian', status: 'submitted', reporterName: 'Christian', slackUserId: `account:${captainId}`, answers: { feedback: 'Done' } },
    { ...emptyAdmin, _id: 'pending-captain', slackUserId: `account:${captainId}` },
    { ...emptyAdmin, _id: 'edited-admin', answers: { feedback: 'Actual draft' } },
    { ...emptyAdmin, _id: 'requested-admin', requestSentAt: new Date() },
    { ...emptyAdmin, _id: 'reminded-admin', reminderCount: 1 },
    { ...emptyAdmin, _id: 'slack-request', slackUserId: 'U123' },
    { ...emptyAdmin, _id: 'chef', reportType: 'kitchen' },
  ];
  const before = JSON.stringify(reports);
  t.mock.method(User, 'find', (filter) => {
    assert.ok(filter._id.$in.includes(adminId));
    assert.deepEqual(filter.role.$in, ['admin', 'super admin', 'bar admin']);
    return query([{ _id: adminId }]);
  });
  t.mock.method(EventReport, 'find', () => query(reports));
  t.mock.method(Event, 'findById', () => query({ _id: eventId, meta: {} }));
  t.mock.method(EventReportFile, 'find', () => query([]));
  t.mock.method(EventReport, 'deleteMany', () => assert.fail('listing must not delete stored reports'));
  const res = response();
  await handler(reportRouter, '/', 'get')({ query: { eventId } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((report) => report._id), reports.slice(1).map((report) => report._id));
  assert.equal(JSON.stringify(reports), before);
});

test('submitted and Slack reports do not need account lookups or get hidden', async (t) => {
  t.mock.method(User, 'find', () => assert.fail('no account query needed'));
  const reports = [{ reportType: 'captain', status: 'submitted', slackUserId: `account:${adminId}` }, { reportType: 'captain', status: 'pending', slackUserId: 'U123' }];
  assert.equal(await visibleEventReports(reports), reports);
});
