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
  await handle({ params: { eventId }, auth: { userId: actor, role: 'staffing admin' }, body: { disabled: true, actor: 'spoofed' } }, res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, { disabled: true, required: false });
});

test('policy API rejects invalid values and event ids without database writes', async (t) => {
  t.mock.method(Event, 'findOneAndUpdate', () => assert.fail('Invalid input must not mutate an event'));
  for (const [id, disabled] of [[eventId, 'true'], [eventId, null], ['bad', true]]) {
    const res = response(); await handle({ params: { eventId: id }, body: { disabled }, auth: { userId: actor, role: 'staffing admin' } }, res);
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


test('only verified owners and Kitchen/Staffing Admin can toggle or cancel captain reports', async (t) => {
  const { canManageCaptainReportRequirement } = await import('../utils/eventReportRequirement.js');
  for (const auth of [{ userId: '68c70548aea053de74d25b22', role: 'admin' }, { userId: '68c7047faea053de74d25b15', role: 'admin' }, { role: 'kitchen admin' }, { role: 'staffing admin' }]) {
    assert.equal(canManageCaptainReportRequirement(auth), true);
  }
  t.mock.method(Event, 'findOneAndUpdate', () => assert.fail('Unauthorized request must not write'));
  t.mock.method(Event, 'findById', () => assert.fail('Unauthorized cancellation must stop before loading'));
  const cancel = router.stack.find((layer) => layer.route?.path === '/events/:eventId/requests/cancel').route.stack.at(-1).handle;
  for (const role of ['admin', 'super admin', 'sales rep', 'manager', 'captain', 'bar captain', 'bar admin', 'event staff']) {
    const auth = { userId: '6ac51f12caed1c8144b1f327', username: 'Iurie', role, canManageRoles: true, accessPermissions: { 'reports.edit': true, 'reports.send': true } };
    assert.equal(canManageCaptainReportRequirement(auth), false);
    for (const handler of [handle, cancel]) {
      const res = response(); await handler({ auth, params: { eventId }, body: { disabled: true } }, res);
      assert.equal(res.code, 403);
    }
  }
});


test('ordinary event edits cannot overwrite the protected report policy or its audit', async (t) => {
  const { updateEventPreservingReportPolicy, withoutCaptainReportPolicy } = await import('../utils/eventReportPolicyGuard.js');
  const audit = [{ disabled: true, actor: 'owner' }];
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ meta: { captainReportDisabled: true, captainReportPolicyAudit: audit } }) }) }));
  t.mock.method(Event, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter['meta.captainReportDisabled'], true);
    assert.deepEqual(filter['meta.captainReportPolicyAudit'], audit);
    assert.equal(update.meta.captainReportDisabled, true);
    assert.deepEqual(update.meta.captainReportPolicyAudit, audit);
    assert.equal(update.meta.venue, 'New venue');
    return update;
  });
  await updateEventPreservingReportPolicy(eventId, { meta: { venue: 'New venue', captainReportDisabled: false, captainReportPolicyAudit: [] } });
  assert.deepEqual(withoutCaptainReportPolicy({ venue: 'Venue', captainReportDisabled: true, captainReportPolicyAudit: audit }), { venue: 'Venue' });
  t.mock.method(Event, 'findOneAndUpdate', async () => null);
  await assert.rejects(updateEventPreservingReportPolicy(eventId, { meta: {} }), { statusCode: 409 });
});
