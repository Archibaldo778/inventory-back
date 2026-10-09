import EventReportSettings from '../models/EventReportSettings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresEventReport, requiresCaptainReport, requiresReportType } from '../utils/eventReportRequirement.js';
import { openCaptainReport } from '../utils/captainReports.js';
import { openStaffKitchenReport } from '../utils/staffKitchenReport.js';
import { serializeStaffEvent } from '../utils/staffPortal.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import BarEvent from '../models/BarEvent.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import barRouter from '../routes/bar.js';
import publicRouter from '../routes/publicEventReports.js';

const names = ['TASTING: Wedding', 'Venue Walk-Through', 'Prada LOAD IN', 'Gala – Load-Out', 'Gala Rental Check-in'];
const eventId = '507f1f77bcf86cd799439001';
const user = { userId: '507f1f77bcf86cd799439002', role: 'captain', email: 'captain@example.com' };
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('tasting, walk-through, load-in and load-out names are exempt regardless of case, spacing or punctuation', () => {
  for (const title of [...names, 'Client walkthrough', 'Client Walk Thru', 'Walk_through for Dinner', 'LOADIN', 'Loadout', 'Menu Tastings', 'RENTAL CHECK IN', 'Rentals Check-In', 'Rental Checkin', 'Rental_Check_In', 'RentalCheckIn']) {
    assert.equal(requiresEventReport({ title }), false, title);
    assert.equal(requiresEventReport({ name: title }), false, title);
    assert.equal(requiresEventReport({ title: 'Dinner' }, { title }), false, title);
  }
  for (const title of ['Dinner', 'Wedding reception', 'Cocktail party', 'Walkway reception', 'Loading dock dinner', 'Tastingson family wedding', 'Rental showroom reception', 'Guest check-in dinner', '']) {
    assert.equal(requiresEventReport({ title }), true, title);
  }
});

test('exempt captain events allow voluntary reports while chef exemptions remain unchanged', async (t) => {
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => null }));
  t.mock.method(EventReport, 'findOneAndUpdate', async (_filter, update) => update.$setOnInsert);
  for (const title of names) {
    assert.equal((await openCaptainReport({ event: { _id: eventId, title }, user })).status, 'pending');
    const chef = { ...user, role: 'event staff', jobTitle: 'executive chef' };
    const entry = { nowstaEventId: '123', title, shifts: [{ position: 'Lead Chef', workers: [{ email: user.email, status: 'confirmed' }] }] };
    const visible = serializeStaffEvent(entry, chef);
    assert.equal(visible.reportRequired, false);
    assert.equal(visible.canUseKitchenReport, false);
    t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => entry }) }));
    await assert.rejects(openStaffKitchenReport(chef, '123'), /No report is required/);
  }
});

test('bar event API flags optional events and allows assigned captains to open reports', async (t) => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'optional-captain';
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => ({ _id: eventId, status: 'pending', slackUserId: `account:${user.userId}` }) }));
  for (const name of names) {
    t.mock.method(BarEvent, 'findById', async () => ({ _id: eventId, name, linkedEventId: eventId, assignedUserIds: [user.userId], items: [], audit: [], save: async () => {} }));
    t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title: name }) }) }));
    const detail = response();
    await handler(barRouter, '/events/:id', 'get')({ auth: user, params: { id: eventId } }, detail);
    assert.equal(detail.code, 200);
    assert.equal(detail.body.reportRequired, false);
    const opened = response();
    await handler(barRouter, '/events/:id/captain-report-link', 'post')({ auth: user, params: { id: eventId } }, opened);
    assert.equal(detail.body.canUseCaptainReport, true);
    assert.equal(opened.code, 200);
    assert.match(opened.body.path, /event-report/);
  }
});

test('old emailed links allow voluntary submission for exempt events', async (t) => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'exemption-test-secret';
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  const report = optionalSubmission(t);
  t.mock.method(EventReport, 'findOne', async () => report);
  const access = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: report.slackUserId });
  for (const title of names) {
    t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title, meta: { eventReportTest: true } }) }) }));
    report.status = 'pending';
    const req = { params: { eventId }, query: { access }, body: { templateRevision: 1, answers: { overallFeedback: 'Useful feedback' } } };
    const loaded = response();
    await handler(publicRouter, '/:eventId', 'get')(req, loaded);
    assert.equal(loaded.code, 200);
    assert.equal(loaded.body.report.reportRequired, false);
    const submitted = response();
    await handler(publicRouter, '/:eventId', 'post')(req, submitted);
    assert.equal(loaded.body.report.reportOptional, true);
    assert.equal(loaded.body.report.reportAvailable, true);
    assert.equal(submitted.code, 200);
    assert.equal(submitted.body.report.status, 'submitted');
  }
});


test('manual captain opt-out leaves kitchen requirements and stored reports intact', async (t) => {
  const event = { _id: eventId, title: 'Dinner', meta: { captainReportDisabled: true } };
  assert.equal(requiresCaptainReport(event), false);
  assert.equal(requiresReportType('captain', event), false);
  assert.equal(requiresReportType('kitchen', event), true);
  t.mock.method(EventReport, 'findOne', () => ({ sort: async () => ({ status: 'pending' }) }));
  assert.equal((await openCaptainReport({ event, user })).status, 'pending');
  assert.equal(requiresCaptainReport({ ...event, meta: { captainReportDisabled: false } }), true);
  assert.equal(requiresReportType('kitchen', { title: 'Rental Check In' }), false);
});

test('already-open captain form becomes optional after the office disables the requirement', async (t) => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'manual-policy-test';
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  const report = optionalSubmission(t);
  t.mock.method(EventReport, 'findOne', async () => report);
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title: 'Dinner', meta: { captainReportDisabled: true, eventReportTest: true } }) }) }));
  const access = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: report.slackUserId });
  const req = { params: { eventId }, query: { access }, body: { templateRevision: 1, answers: { overallFeedback: 'Useful feedback' } } };
  const loaded = response(); await handler(publicRouter, '/:eventId', 'get')(req, loaded);
  assert.equal(loaded.body.report.reportRequired, false);
  const submitted = response(); await handler(publicRouter, '/:eventId', 'post')(req, submitted);
  assert.equal(loaded.body.report.reportOptional, true);
  assert.equal(submitted.code, 200);
});


function optionalSubmission(t) {
  const old = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  t.after(() => { if (old === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old; });
  t.mock.method(globalThis, 'fetch', () => assert.fail('No external calls'));
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => null }));
  const report = { _id: eventId, eventId, slackUserId: `account:${user.userId}`, reportType: 'captain', status: 'pending',
    templateSnapshot: { revision: 1, sections: [{ key: 'feedback', title: 'Feedback', fields: [{ key: 'overallFeedback', label: 'Feedback', type: 'textarea', required: true }] }] },
    save: async () => {}, toObject() { return { ...this }; } };
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.status, 'pending'); assert.equal(update.$set.digestRequested, false);
    Object.assign(report, update.$set); return report;
  });
  return report;
}
