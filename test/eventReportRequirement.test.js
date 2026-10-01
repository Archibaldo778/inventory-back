import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresEventReport } from '../utils/eventReportRequirement.js';
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

const names = ['TASTING: Wedding', 'Venue Walk-Through', 'Prada LOAD IN', 'Gala – Load-Out'];
const eventId = '507f1f77bcf86cd799439001';
const user = { userId: '507f1f77bcf86cd799439002', role: 'captain', email: 'captain@example.com' };
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('tasting, walk-through, load-in and load-out names are exempt regardless of case, spacing or punctuation', () => {
  for (const title of [...names, 'Client walkthrough', 'Client Walk Thru', 'Walk_through for Dinner', 'LOADIN', 'Loadout', 'Menu Tastings']) {
    assert.equal(requiresEventReport({ title }), false, title);
    assert.equal(requiresEventReport({ name: title }), false, title);
    assert.equal(requiresEventReport({ title: 'Dinner' }, { title }), false, title);
  }
  for (const title of ['Dinner', 'Wedding reception', 'Cocktail party', 'Walkway reception', 'Loading dock dinner', 'Tastingson family wedding', '']) {
    assert.equal(requiresEventReport({ title }), true, title);
  }
});

test('exempt captain and chef events cannot create reports, and chef cards do not offer Kitchen Report', async (t) => {
  t.mock.method(EventReport, 'findOne', () => assert.fail('No report lookup or creation for exempt events'));
  for (const title of names) {
    await assert.rejects(openCaptainReport({ event: { _id: eventId, title }, user }), /No report is required/);
    const chef = { ...user, role: 'event staff', jobTitle: 'executive chef' };
    const entry = { nowstaEventId: '123', title, shifts: [{ position: 'Lead Chef', workers: [{ email: user.email, status: 'confirmed' }] }] };
    const visible = serializeStaffEvent(entry, chef);
    assert.equal(visible.reportRequired, false);
    assert.equal(visible.canUseKitchenReport, false);
    t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => entry }) }));
    await assert.rejects(openStaffKitchenReport(chef, '123'), /No report is required/);
  }
});

test('bar event API flags exempt events and rejects creating a captain report through a direct request', async (t) => {
  t.mock.method(EventReport, 'findOne', () => assert.fail('Must not create or open an exempt report'));
  for (const name of names) {
    t.mock.method(BarEvent, 'findById', async () => ({ _id: eventId, name, linkedEventId: eventId, assignedUserIds: [user.userId], items: [] }));
    t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title: name }) }) }));
    const detail = response();
    await handler(barRouter, '/events/:id', 'get')({ auth: user, params: { id: eventId } }, detail);
    assert.equal(detail.code, 200);
    assert.equal(detail.body.reportRequired, false);
    const opened = response();
    await handler(barRouter, '/events/:id/captain-report-link', 'post')({ auth: user, params: { id: eventId } }, opened);
    assert.equal(opened.code, 403);
    assert.match(opened.body.error, /No report is required/);
  }
});

test('old emailed report links show an exemption and cannot submit a pending report for an exempt event', async (t) => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'exemption-test-secret';
  t.after(() => { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; });
  const report = { _id: eventId, eventId, slackUserId: `account:${user.userId}`, reportType: 'captain', status: 'pending', save: () => assert.fail('Exempt report must not be submitted') };
  t.mock.method(EventReport, 'findOne', async () => report);
  const access = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: report.slackUserId });
  for (const title of names) {
    t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title }) }) }));
    const req = { params: { eventId }, query: { access }, body: { answers: {} } };
    const loaded = response();
    await handler(publicRouter, '/:eventId', 'get')(req, loaded);
    assert.equal(loaded.code, 200);
    assert.equal(loaded.body.report.reportRequired, false);
    const submitted = response();
    await handler(publicRouter, '/:eventId', 'post')(req, submitted);
    assert.equal(submitted.code, 403);
    assert.match(submitted.body.message, /No report is required/);
  }
});
