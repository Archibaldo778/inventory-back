import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportTemplate from '../models/EventReportTemplate.js';
import { defaultReportTemplate, templateFields } from '../utils/captainReportTemplate.js';
import EventReportSettings from '../models/EventReportSettings.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import router from '../routes/staffPortal.js';
import publicRouter from '../routes/publicEventReports.js';
import { openStaffKitchenReport, validateStaffKitchenReportAccess, staffKitchenReporterName } from '../utils/staffKitchenReport.js';
import { renderEventReportEmail } from '../utils/eventReportEmail.js';
import { canUseKitchenReport, eventStaffRequestAllowed } from '../utils/eventStaffAccess.js';
import { serializeStaffEvent } from '../utils/staffPortal.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';

const userId = '507f1f77bcf86cd799439011';
const eventId = '507f1f77bcf86cd799439012';
const chef = { _id: userId, userId, role: 'event staff', jobTitle: 'executive chef', email: 'maye@example.com', username: 'Maye', nowstaName: 'Maye La Monica', isActive: true };
const entry = { nowstaEventId: '123', title: 'Dinner', date: '2026-10-01', shifts: [{ position: 'Executive Chef', workers: [{ email: chef.email, status: 'confirmed' }] }] };
const event = { _id: eventId, title: 'Dinner', date: entry.date, meta: { nowsta: { apiEventId: '123' }, salesRep: 'Olivier Cheng' } };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (source, path, method) => source.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const mockSources = (t, schedule = entry) => {
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => schedule }) }));
  t.mock.method(Event, 'findOne', () => ({ select: () => ({ lean: async () => event }) }));
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => event }) }));
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => chef }) }));
};
const secret = (t) => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'staff-kitchen-test-secret';
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
};

test('Kitchen Report resolves the matched worker name instead of a job title in the profile', async (t) => {
  const user = { ...chef, username: 'Maye Lamonica', nowstaName: 'Executive Chef', jobTitle: '' };
  const schedule = { ...entry, shifts: [{ position: 'Lead Chef', workers: [
    { name: 'Another Chef', email: 'another@example.com', status: 'confirmed' },
    { name: 'Declined Name', email: user.email, status: 'declined' },
    { name: 'Maye Lamonica', email: user.email, status: 'confirmed' },
  ] }] };
  mockSources(t, schedule);
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  t.mock.method(EventReport, 'findOneAndUpdate', async (_query, update) => update.$setOnInsert);
  const { report } = await openStaffKitchenReport(user, '123');
  assert.equal(report.reporterName, 'Maye Lamonica');
  assert.equal(report.position, 'Lead Chef');
  assert.equal(report.reporterEmail, chef.email);
  assert.equal(staffKitchenReporterName(user, entry), 'Maye Lamonica');
  assert.equal(staffKitchenReporterName({ ...user, username: 'Kitchen Lead' }, entry), user.email);
  assert.equal(staffKitchenReporterName(chef, entry), chef.nowstaName);
});

test('Event Staff report requests reach the assignment check without granting other write permissions', () => {
  const req = { method: 'POST', originalUrl: '/api/staff-portal/events/123/kitchen-report-link' };
  assert.equal(canUseKitchenReport(chef), false);
  assert.equal(canUseKitchenReport(chef, entry.shifts), true);
  assert.equal(eventStaffRequestAllowed(chef, req), true);
  assert.equal(eventStaffRequestAllowed({ ...chef, jobTitle: '' }, req), true);
  assert.equal(eventStaffRequestAllowed(chef, { ...req, originalUrl: '/api/products' }), false);
  assert.equal(serializeStaffEvent(entry, chef).canUseKitchenReport, true);
  assert.equal(serializeStaffEvent(entry, { ...chef, jobTitle: '' }).canUseKitchenReport, true);
});

test('opening Kitchen Report creates a chef-specific report and does not reuse the captain identity', async (t) => {
  mockSources(t);
  t.mock.method(EventReport, 'findOne', (query) => {
    assert.equal(query.reportType, 'kitchen');
    return { sort: async () => null };
  });
  let created;
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.slackUserId, `account:${userId}:kitchen`);
    created = update.$setOnInsert;
    return { _id: 'report-1', ...created };
  });
  const { report } = await openStaffKitchenReport(chef, '123');
  assert.equal(report.reportType, 'kitchen');
  assert.equal(report.position, 'Executive Chef');
  assert.equal(report.reporterName, 'Maye La Monica');
  assert.equal(report.reporterEmail, chef.email);
  assert.equal(report.salesRep, 'Olivier Cheng');
  assert.equal(report.eventId, eventId);
});

test('reopening pending or submitted Kitchen Reports preserves existing answers, including Slack reports', async (t) => {
  mockSources(t);
  for (const status of ['pending', 'submitted']) {
    const existing = { _id: 'report-1', eventId, reportType: 'kitchen', slackUserId: 'slack-chef:kitchen', reporterEmail: chef.email, status, answers: { foodQuality: 'Excellent' } };
    t.mock.method(EventReport, 'findOne', () => ({ sort: async () => existing }));
    t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('Existing report must not be replaced'));
    const opened = await openStaffKitchenReport(chef, '123');
    assert.equal(opened.report, existing);
    assert.equal(opened.report.answers.foodQuality, 'Excellent');
  }
});

test('Kitchen Report cannot be opened for an unassigned, archived or unlinked event', async (t) => {
  mockSources(t, null);
  await assert.rejects(openStaffKitchenReport({ ...chef, role: 'captain' }, '123'), /Kitchen reporting account/);
  await assert.rejects(openStaffKitchenReport(chef, '123'), /not assigned/);
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => ({ ...entry, archived: true }) }) }));
  await assert.rejects(openStaffKitchenReport(chef, '123'), /not assigned/);
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => entry }) }));
  t.mock.method(Event, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
  await assert.rejects(openStaffKitchenReport(chef, '123'), /not linked/);
});

test('a chef can open and submit an unfilled Kitchen Report 14 days after the event, but cannot submit twice', async (t) => {
  t.mock.method(EventReportTemplate, 'findById', () => ({ lean: async () => null }));
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T16:00:00Z') });
  secret(t);
  const leadChef = { ...chef, role: 'kitchen lead', jobTitle: '', nowstaName: 'Executive Chef' };
  mockSources(t, { ...entry, shifts: [{ position: 'Lead Chef', workers: [{ email: chef.email, status: 'confirmed', name: 'Maye Lamonica' }] }] });
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => leadChef }) }));
  const report = { _id: 'report-1', eventId, eventTitle: 'Dinner', reportType: 'kitchen', slackUserId: `account:${userId}:kitchen`, reporterName: 'Executive Chef', status: 'pending', answers: {}, save: async () => {}, toObject() { return { ...this }; } };
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.status, 'pending'); Object.assign(report, update.$set); return report;
  });
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => report }));
  const opened = response();
  await handler(router, '/events/:id/kitchen-report-link', 'post')({ auth: leadChef, params: { id: '123' } }, opened);
  assert.equal(opened.code, 200);
  const accessToken = new URL(opened.body.path, 'https://example.com').searchParams.get('access');
  const access = verifyEventGuestAccess(accessToken, eventId, 'event:report');
  assert.equal(access.subjectId, report.slackUserId);
  assert.equal(access.context, `staff-kitchen:${userId}`);
  t.mock.method(EventReport, 'findOne', async () => report);
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => ({ emailEnabled: false }) }));
  const request = { params: { eventId }, query: { access: accessToken }, body: {} };
  const loaded = response();
  await handler(publicRouter, '/:eventId', 'get')(request, loaded);
  assert.equal(loaded.body.report.reportType, 'kitchen');
  assert.equal(loaded.body.report.reporterName, 'Maye Lamonica');
  assert.equal(report.reporterName, 'Executive Chef', 'Preview does not write to the saved draft');
  const incomplete = response();
  await handler(publicRouter, '/:eventId', 'post')({ ...request, body: { answers: { overallFeedback: 'Captain answer' } } }, incomplete);
  assert.equal(incomplete.code, 400);
  const fields = templateFields(defaultReportTemplate('kitchen'));
  const submitted = response();
  await handler(publicRouter, '/:eventId', 'post')({ ...request, body: { answers: Object.fromEntries(fields.map((field) => [field.key, field.type === 'choice' ? field.options[0] : 'N/A'])) } }, submitted);
  assert.equal(submitted.code, 200);
  assert.equal(report.status, 'submitted');
  assert.equal(report.reporterName, 'Maye Lamonica');
  const email = renderEventReportEmail(report);
  assert.match(email, /Maye Lamonica/);
  assert.doesNotMatch(email, /Executive Chef/);
  assert.equal(report.answers.overallEvaluation, 'N/A');
  assert.equal(report.answers.overallFeedback, undefined);
  const duplicate = response();
  await handler(publicRouter, '/:eventId', 'post')(request, duplicate);
  assert.equal(duplicate.code, 409);
  // Previously issued links stop working after removal from the event.
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
  for (const method of ['get', 'post']) {
    const denied = response();
    await handler(publicRouter, '/:eventId', method)(request, denied);
    assert.equal(denied.code, 403);
  }
});

test('kitchen portal access is revoked when the chef account is disabled or loses its Event Staff role', async (t) => {
  mockSources(t);
  const access = { context: `staff-kitchen:${userId}` };
  for (const user of [{ ...chef, isActive: false }, { ...chef, role: 'captain' }]) {
    t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => user }) }));
    await assert.rejects(validateStaffKitchenReportAccess(access, { eventId, reportType: 'kitchen' }), /no longer available/);
  }
  await validateStaffKitchenReportAccess({ context: 'captain-portal' }, { reportType: 'captain' });
});

test('Lead Chef assignment shows Kitchen Report without a profile job title, but another worker’s chef shift does not', () => {
  const user = { ...chef, jobTitle: '' };
  const leadShift = { position: 'Lead Chef', workers: [{ email: chef.email, status: 'confirmed' }] };
  assert.equal(serializeStaffEvent({ ...entry, shifts: [leadShift] }, user).canUseKitchenReport, true);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [
    { position: 'Server', workers: [{ email: chef.email, status: 'confirmed' }] },
    { ...leadShift, workers: [{ email: 'other@example.com', status: 'confirmed' }] },
  ] }, user).canUseKitchenReport, false);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [
    { position: 'Server', workers: [{ email: chef.email, status: 'confirmed' }] },
    { ...leadShift, workers: [{ email: chef.email, status: 'declined' }] },
  ] }, user).canUseKitchenReport, false);
});

test('new report uses the actual Lead Chef position and rejects a staff member without a chef assignment', async (t) => {
  const user = { ...chef, jobTitle: '' };
  let schedule = { ...entry, shifts: [{ ...entry.shifts[0], position: 'Lead Chef' }] };
  mockSources(t);
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => schedule }) }));
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  let writes = 0;
  t.mock.method(EventReport, 'findOneAndUpdate', async (_filter, update) => { writes += 1; return update.$setOnInsert; });
  const { report } = await openStaffKitchenReport(user, '123');
  assert.equal(report.position, 'Lead Chef');
  assert.equal(report.reportType, 'kitchen');
  schedule = { ...entry, shifts: [{ ...entry.shifts[0], position: 'Server' }] };
  await assert.rejects(openStaffKitchenReport(user, '123'), /Lead Chef assignment/);
  assert.equal(writes, 1);
});

test('saved report link is revoked if Lead Chef becomes Event Chef even with an Executive Chef profile', async (t) => {
  mockSources(t, { ...entry, shifts: [{ ...entry.shifts[0], position: 'Event Chef' }] });
  await assert.rejects(validateStaffKitchenReportAccess({ context: `staff-kitchen:${userId}` }, { eventId, reportType: 'kitchen' }), /no longer available/);
});


test('Event Chef never requires a Kitchen Report based on account role or Executive Chef profile alone', async (t) => {
  const schedule = { ...entry, shifts: [{ ...entry.shifts[0], position: 'Event Chef' }] };
  mockSources(t, schedule);
  t.mock.method(EventReport, 'findOne', () => assert.fail('An Event Chef must not create or open a report'));
  for (const role of ['event staff', 'kitchen lead']) {
    const user = { ...chef, role };
    assert.equal(serializeStaffEvent(schedule, user).canUseKitchenReport, false);
    await assert.rejects(openStaffKitchenReport(user, '123'), /Lead Chef assignment/);
    for (const position of ['Lead Chef', 'Kitchen Lead', 'Proofer Lead', 'Executive Chef']) {
      assert.equal(serializeStaffEvent({ ...entry, shifts: [{ ...entry.shifts[0], position }] }, user).canUseKitchenReport, true);
    }
  }
});


test('a confirmed Proofer Lead can open their Kitchen Report and keeps the actual event position', async (t) => {
  const proofer = { ...chef, role: 'kitchen lead', jobTitle: '' };
  mockSources(t, { ...entry, shifts: [{ ...entry.shifts[0], position: 'Proofer Lead' }] });
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  t.mock.method(EventReport, 'findOneAndUpdate', async (_filter, update) => ({ _id: 'proofer-report', ...update.$setOnInsert }));
  const { report } = await openStaffKitchenReport(proofer, '123');
  assert.equal(report.reportType, 'kitchen');
  assert.equal(report.position, 'Proofer Lead');
  assert.equal(report.slackUserId, `account:${userId}:kitchen`);
  const otherLead = { ...entry, shifts: [
    { position: 'Event Chef', workers: [{ email: proofer.email, status: 'confirmed' }] },
    { position: 'Proofer Lead', workers: [{ email: 'other@example.com', status: 'confirmed' }] },
  ] };
  assert.equal(serializeStaffEvent(otherLead, proofer).canUseKitchenReport, false);
});
