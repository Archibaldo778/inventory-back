import test from 'node:test';
import assert from 'node:assert/strict';
import publicRouter from '../routes/publicEventReports.js';
import barRouter from '../routes/bar.js';
import adminRouter from '../routes/eventReports.js';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import EventReport from '../models/EventReport.js';
import EventReportSettings from '../models/EventReportSettings.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import { defaultCaptainTemplate, templateFields } from '../utils/captainReportTemplate.js';
import { issueEventGuestAccess, verifyEventGuestAccess } from '../utils/eventGuestAccess.js';

const eventId = '507f1f77bcf86cd799439011';
const reportId = '507f1f77bcf86cd799439012';
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const env = (t, key, value) => {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
};
const accessRequest = (t, body = {}) => {
  env(t, 'JWT_SECRET', 'report-prefill-test-secret');
  return { params: { eventId }, query: { access: issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: 'account:captain1' }) }, body };
};
const mockEvent = (t) => t.mock.method(Event, 'findById', (id) => {
  assert.equal(String(id), eventId);
  return { select: () => ({ lean: async () => ({ _id: eventId, title: 'Test event', meta: { salesRep: 'Olivier Cheng' } }) }) };
});

test('captain portal creates a report with the Dashboard account rep even when Bar Event is stale', async (t) => {
  env(t, 'JWT_SECRET', 'report-prefill-test-secret');
  mockEvent(t);
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  t.mock.method(BarEvent, 'findById', async () => ({ linkedEventId: eventId, salesRep: 'Old Rep', assignedUserIds: ['captain1'], audit: [], save: async () => {} }));
  let inserted;
  t.mock.method(EventReport, 'findOneAndUpdate', async (_filter, update) => {
    inserted = update.$setOnInsert;
    return { _id: reportId, ...inserted };
  });
  const res = response();
  await handler(barRouter, '/events/:id/captain-report-link', 'post')({ params: { id: eventId }, auth: { userId: 'captain1', role: 'captain', username: 'Test Captain', email: 'captain@example.com' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(inserted.salesRep, 'Olivier Cheng');
  assert.match(res.body.path, /event-report/);
});

test('captain portal reuses the emailed or Slack report and signs its existing identity', async (t) => {
  env(t, 'JWT_SECRET', 'report-prefill-test-secret');
  mockEvent(t);
  t.mock.method(BarEvent, 'findById', async () => ({ linkedEventId: eventId, assignedUserIds: ['captain1'], audit: [], save: async () => {} }));
  t.mock.method(EventReport, 'findOne', (query) => {
    assert.equal(query.reportType, 'captain');
    assert.deepEqual(query.$or[1], { reporterEmail: 'captain@example.com' });
    return { sort: async () => ({ _id: reportId, slackUserId: 'slack-captain', status: 'submitted' }) };
  });
  t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('Must not create a second report'));
  const res = response();
  await handler(barRouter, '/events/:id/captain-report-link', 'post')({ params: { id: eventId }, auth: { userId: 'captain1', role: 'captain', email: 'captain@example.com' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report.status, 'submitted');
  const token = new URL(res.body.path, 'https://example.com').searchParams.get('access');
  assert.equal(verifyEventGuestAccess(token, eventId, 'event:report').subjectId, 'slack-captain');
});

test('captains and bar captains can reopen an unfilled report for a closed event from 14 days ago', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T16:00:00Z') });
  env(t, 'JWT_SECRET', 'report-prefill-test-secret');
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title: 'Past dinner', date: '2026-10-01' }) }) }));
  t.mock.method(BarEvent, 'findById', async () => ({ linkedEventId: eventId, eventDate: '2026-10-01', status: 'closed', assignedUserIds: ['captain1'], audit: [], save: async () => {} }));
  const report = { _id: reportId, eventId, slackUserId: 'account:captain1', eventDate: '2026-10-01', status: 'pending', templateSnapshot: defaultCaptainTemplate(), answers: { overallFeedback: 'Existing draft' } };
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { eventId, slackUserId: 'account:captain1' });
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    return report;
  });
  t.mock.method(EventReport, 'findOne', () => Object.assign(Promise.resolve(report), { sort: async () => report }));
  for (const role of ['captain', 'bar captain']) {
    const opened = response();
    await handler(barRouter, '/events/:id/captain-report-link', 'post')({ params: { id: eventId }, auth: { userId: 'captain1', role } }, opened);
    assert.equal(opened.statusCode, 200);
    const access = new URL(opened.body.path, 'https://example.com').searchParams.get('access');
    const loaded = response();
    await handler(publicRouter, '/:eventId', 'get')({ params: { eventId }, query: { access } }, loaded);
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.body.report.status, 'pending');
    assert.equal(loaded.body.report.answers.overallFeedback, 'Existing draft');
  }
});

test('opening an existing empty report prefills the account rep without writing or changing answers', async (t) => {
  const req = accessRequest(t);
  mockEvent(t);
  const report = { _id: reportId, eventId, status: 'pending', salesRep: '', templateSnapshot: defaultCaptainTemplate(), answers: { overallFeedback: 'Existing draft' } };
  t.mock.method(EventReport, 'findOne', async (filter) => {
    assert.deepEqual(filter, { eventId, slackUserId: 'account:captain1' });
    return report;
  });
  const res = response();
  await handler(publicRouter, '/:eventId', 'get')(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report.salesRep, 'Olivier Cheng');
  assert.deepEqual(res.body.report.answers, report.answers);
  assert.equal(report.salesRep, '');
});

test('submitting a previously empty report saves its rep and sends to that rep’s team', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const answers = Object.fromEntries([
    'staffEnough', 'staffingResponsive', 'uniformsReturned', 'staffAppearance', 'foodProvidedByOcc',
    'foodMetStandards', 'leadChefCooperative', 'barProductProvidedByOcc', 'barServiceMetStandards',
    'barProductEnough', 'beverageCountsCompleted', 'rentalEquipmentEnough', 'sanitationCooperative',
    'finalWalkthrough', 'actualGuestCount', 'rerunsOrPurchases', 'paperworkAccurate', 'partyExtended',
    'staffStayedLate', 'prepWorkTimeAdded', 'healthSafetyIssues', 'overallFeedback',
  ].map((field) => [field, 'N/A']));
  for (const field of templateFields(defaultCaptainTemplate())) if (field.type === 'choice') answers[field.key] = field.options[0];
  const req = accessRequest(t, { answers });
  mockEvent(t);
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => ({ emailEnabled: false }) }));
  const saves = [];
  const report = { _id: reportId, eventId, reportType: 'captain', reporterEmail: 'captain@example.com', status: 'pending', salesRep: '',
    save: async function () { saves.push({ salesRep: this.salesRep, status: this.status }); },
    toObject() { return { ...this }; },
  };
  t.mock.method(EventReport, 'findOne', async () => report);
  let sent;
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: reportId, status: 'pending', templateSnapshot: null });
    Object.assign(report, update.$set); return report;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 'test-report-email' }) };
  });
  const res = response();
  await handler(publicRouter, '/:eventId', 'post')(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(saves[0], { salesRep: 'Olivier Cheng', status: 'submitted' });
  assert.deepEqual(sent.to, ['captainreport@ocnyc.com', 'olivier@ocnyc.com', 'heidi@ocnyc.com', 'sebastian@ocnyc.com', 'ashley@ocnyc.com']);
  assert.deepEqual(sent.cc, ['captain@example.com']);
  assert.equal(res.body.report.salesRep, 'Olivier Cheng');
});

test('explicit email retry fills a missing submitted rep before resolving team recipients', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  mockEvent(t);
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => null }));
  const report = { _id: reportId, eventId, status: 'submitted', salesRep: '', save: async () => {}, toObject() { return { ...this }; } };
  t.mock.method(EventReport, 'findById', async () => report);
  let sent;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 'test-retry-email' }) };
  });
  const res = response();
  await handler(adminRouter, '/:reportId/email', 'post')({ params: { reportId }, body: { force: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(report.salesRep, 'Olivier Cheng');
  assert.ok(sent.to.includes('heidi@ocnyc.com'));
});

test('cancelled report links display no requirement and cannot submit or send email', async (t) => {
  const req = accessRequest(t); mockEvent(t);
  t.mock.method(EventReport, 'findOne', async () => ({ _id: reportId, eventId, status: 'cancelled', reportType: 'captain' }));
  t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('Cancelled requests must not be submitted'));
  t.mock.method(globalThis, 'fetch', () => assert.fail('Cancelled requests must not send email'));
  const loaded = response(); await handler(publicRouter, '/:eventId', 'get')(req, loaded);
  assert.equal(loaded.body.report.reportRequired, false);
  const submitted = response(); await handler(publicRouter, '/:eventId', 'post')(req, submitted);
  assert.equal(submitted.statusCode, 403);
});

test('a form opened before cancellation cannot revive the request or send its report email', async (t) => {
  const fields = ['staffEnough', 'staffingResponsive', 'uniformsReturned', 'staffAppearance', 'foodProvidedByOcc',
    'foodMetStandards', 'leadChefCooperative', 'barProductProvidedByOcc', 'barServiceMetStandards', 'barProductEnough',
    'beverageCountsCompleted', 'rentalEquipmentEnough', 'sanitationCooperative', 'finalWalkthrough', 'actualGuestCount',
    'rerunsOrPurchases', 'paperworkAccurate', 'partyExtended', 'staffStayedLate', 'prepWorkTimeAdded', 'healthSafetyIssues', 'overallFeedback'];
  const req = accessRequest(t, { answers: Object.fromEntries(fields.map((field) => [field, 'N/A'])) }); mockEvent(t);
  for (const field of templateFields(defaultCaptainTemplate())) if (field.type === 'choice') req.body.answers[field.key] = field.options[0];
  t.mock.method(EventReport, 'findOne', async () => ({ _id: reportId, eventId, status: 'pending', reportType: 'captain' }));
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter) => { assert.equal(filter.status, 'pending'); return null; });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Losing submission must not send email'));
  const res = response(); await handler(publicRouter, '/:eventId', 'post')(req, res);
  assert.equal(res.statusCode, 409);
});
