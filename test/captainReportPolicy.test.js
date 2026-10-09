import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import router from '../routes/eventReports.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildEventReportRequests } from '../utils/eventReportRequests.js';

const eventId = '507f1f77bcf86cd799439001';
const actor = '507f1f77bcf86cd799439002';
const path = `/api/event-reports/events/${eventId}/captain-report-policy`;
const handle = router.stack.find((layer) => layer.route?.path === '/events/:eventId/captain-report-policy').route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('captain policy writes only its event flag and records the authenticated actor', async (t) => {
  t.mock.method(Event, 'findOneAndUpdate', (filter, update) => {
    assert.deepEqual(filter, { _id: eventId });
    assert.deepEqual(update.$set, { 'meta.captainReportDisabled': true });
    const audit = update.$push['meta.captainReportPolicyAudit'].$each[0];
    assert.equal(audit.actor, actor); assert.equal(audit.disabled, true); assert.ok(audit.at instanceof Date);
    return { select: () => ({ lean: async () => ({ title: 'Dinner', meta: { captainReportDisabled: true } }) }) };
  });
  const res = response();
  await handle({ params: { eventId }, auth: { userId: actor }, body: { disabled: true, actor: 'spoofed' } }, res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, { disabled: true, required: false });
});

test('policy API rejects invalid values and event ids without database writes', async (t) => {
  t.mock.method(Event, 'findOneAndUpdate', () => assert.fail('Invalid input must not mutate an event'));
  for (const [id, disabled] of [[eventId, 'true'], [eventId, null], ['bad', true]]) {
    const res = response(); await handle({ params: { eventId: id }, body: { disabled }, auth: { userId: actor } }, res);
    assert.equal(res.code, 400);
  }
});

test('report management guard denies unauthenticated users and captain accounts', () => {
  for (const role of [null, 'captain', 'bar captain', 'bartender', 'event staff']) {
    const res = response(); let allowed = false;
    requireAdmin({ auth: role ? { userId: actor, role } : undefined, method: 'PUT', originalUrl: path }, res, () => { allowed = true; });
    assert.equal(allowed, false); assert.equal(res.code, role ? 403 : 401);
  }
  let allowed = false;
  requireAdmin({ auth: { userId: actor, role: 'admin' }, method: 'PUT', originalUrl: path }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('disabled event labels pending captain requests not required without changing kitchen or submitted records', () => {
  const reports = [
    { _id: 'pending', reportType: 'captain', status: 'pending' },
    { _id: 'saved', reportType: 'captain', status: 'submitted', answers: { notes: 'Saved' } },
    { _id: 'chef', reportType: 'kitchen', status: 'pending' },
  ];
  const items = buildEventReportRequests({ event: { title: 'Dinner', meta: { captainReportDisabled: true } }, schedule: null, users: [], reports });
  assert.equal(items[0].status, 'not_required'); assert.equal(items[0].canCancelRequest, false);
  assert.equal(items[1].status, 'submitted'); assert.deepEqual(items[1].answers, reports[1].answers);
  assert.equal(items[2].status, 'pending'); assert.equal(reports[0].status, 'pending');
});
