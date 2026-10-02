import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/Users.js';
import { canUseKitchenReport, canReadStaffInventory, eventStaffRequestAllowed } from '../utils/eventStaffAccess.js';
import { serializeStaffEvent } from '../utils/staffPortal.js';
import { canInviteUserAsRole, renderUserInviteEmail } from '../utils/userInvitations.js';
import { sendEventReportEmail } from '../utils/eventReportEmail.js';
import router from '../routes/users.js';

const env = (t, key, value) => { const old = process.env[key]; process.env[key] = value; t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); };
const chef = { userId: '507f1f77bcf86cd799439011', username: 'Chef', email: 'chef@example.com', role: 'kitchen lead', permissions: { inventoryRead: true } };

test('Kitchen Lead can use assigned kitchen reports but cannot read decor even with stale inventory permission', () => {
  assert.ok(User.schema.path('role').enumValues.includes('kitchen lead'));
  assert.equal(canReadStaffInventory(chef), false);
  for (const path of ['/api/products', '/api/pages', '/api/events', '/api/staff-portal/inventory', '/api/assistant', '/api/bar/events', '/api/uniform-packing/events']) {
    assert.equal(eventStaffRequestAllowed(chef, { method: 'GET', originalUrl: path }), false, path);
  }
  assert.equal(eventStaffRequestAllowed(chef, { method: 'GET', originalUrl: '/api/staff-portal/events' }), true);
  assert.equal(eventStaffRequestAllowed(chef, { method: 'POST', originalUrl: '/api/staff-portal/events/42/kitchen-report-link' }), true);
  assert.equal(eventStaffRequestAllowed(chef, { method: 'POST', originalUrl: '/api/staff-portal/events/42' }), false);
  const executive = { role: 'event staff', jobTitle: 'executive chef', permissions: { inventoryRead: true } };
  assert.equal(canReadStaffInventory(executive), true);
  assert.equal(canUseKitchenReport(executive), false);
  assert.equal(canUseKitchenReport(executive, [{ position: 'Executive Chef' }]), true);
});

test('Kitchen Lead report eligibility follows their booked position, not another chef’s shift or stale executive title', () => {
  const shift = (position, email = chef.email) => ({ position, workers: [{ email, status: 'confirmed' }] });
  const entry = { nowstaEventId: '42', title: 'Dinner', shifts: [shift('Lead Chef')] };
  assert.equal(serializeStaffEvent(entry, chef).canUseKitchenReport, true);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [shift('Kitchen Lead')] }, chef).canUseKitchenReport, true);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [shift('Bartender'), shift('Lead Chef', 'other@example.com')] }, { ...chef, jobTitle: 'executive chef' }).canUseKitchenReport, false);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [shift('Lead Chef', 'other@example.com')] }, chef), null);
});

test('Kitchen Lead invitation explains registration and kitchen reports only and cannot silently change other roles', () => {
  const invite = renderUserInviteEmail({ role: chef.role, name: chef.username, inviteUrl: 'https://example.com/invite' });
  assert.match(invite.text, /Create your password/);
  assert.match(invite.text, /Kitchen Report/);
  assert.match(invite.text, /48 hours/);
  assert.doesNotMatch(invite.text, /Captain|Bar Returns|alcohol|decor/i);
  assert.match(renderUserInviteEmail({ role: chef.role, active: true }).text, /existing password/);
  assert.equal(canInviteUserAsRole('kitchen lead', 'kitchen lead'), true);
  for (const role of ['captain', 'bar captain', 'event staff', 'uniform packer', 'admin']) assert.equal(canInviteUserAsRole(role, 'kitchen lead'), false);
});

test('inviting a Kitchen Lead creates a registration account and sends only the selected recipient plus CC', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  let created; let email;
  t.mock.method(User, 'findOne', () => ({ select: async () => null }));
  t.mock.method(User, 'create', async (body) => { created = { ...body, save: async () => {} }; return created; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { email = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'invite' }) }; });
  const handler = router.stack.find((layer) => layer.route?.path === '/invite' && layer.route.methods.post).route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ body: { username: chef.username, email: chef.email, role: chef.role, cc: 'copy@example.com' } }, res);
  assert.equal(res.code, 201); assert.equal(created.role, 'kitchen lead'); assert.equal(created.isActive, false);
  assert.ok(created.inviteTokenHash); assert.ok(created.inviteSentAt);
  assert.deepEqual(email.to, [chef.email]); assert.deepEqual(email.cc, ['copy@example.com']);
  assert.match(email.text, /Kitchen Report/);
});

test('Kitchen Reports use the lead chef mailbox plus the configured Sales team and copy the submitting chef', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  env(t, 'LEAD_CHEF_REPORT_EMAIL', 'leadchefreport@ocnyc.com');
  const teams = [{ _id: 'team', salesUserId: 'sales', reportDeliveryEnabled: true }];
  const users = [{ _id: 'sales', username: 'Sales', email: 'sales@example.com' },
    { _id: 'assistant', username: 'Assistant', email: 'assistant@example.com', teamId: 'team', receivesTeamReports: true },
    { _id: 'off', email: 'excluded@example.com', teamId: 'team', receivesTeamReports: false }];
  let outgoing; let calls = 0;
  const result = await sendEventReportEmail({ event: { meta: { reportSalesUserId: 'sales' } }, report: { reportType: 'kitchen', reporterEmail: chef.email, status: 'submitted' },
    loadTeams: async () => ({ teams, users }), generateBrief: async () => ({ summary: 'Service went well.', attention: [] }),
    configuredRecipients: ['captainreport@ocnyc.com'],
    fetchImpl: async (_url, options) => { calls++; outgoing = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'report' }) }; } });
  assert.equal(result.status, 'sent'); assert.equal(calls, 1);
  assert.deepEqual(outgoing.to, ['leadchefreport@ocnyc.com', 'sales@example.com', 'assistant@example.com']);
  assert.deepEqual(outgoing.cc, [chef.email]); assert.match(outgoing.html, /AI QUICK SUMMARY/);
});

test('Kitchen legacy routing keeps George with Megan and Guillaume without assistants; missing Sales blocks delivery', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  for (const [salesRep, expected] of [['George', ['george@example.com', 'megan@example.com']], ['Guillaume', ['guillaume@example.com']], ['', null]]) {
    let outgoing;
    const result = await sendEventReportEmail({ event: {}, report: { reportType: 'kitchen', salesRep },
      loadTeams: async () => ({ teams: [], users: [] }),
      loadSlackUsers: async () => ['George', 'Megan', 'Guillaume'].map((name) => ({ profile: { real_name: name, email: `${name.toLowerCase()}@example.com` } })),
      fetchImpl: async (_url, options) => { outgoing = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'report' }) }; } });
    if (expected) { assert.equal(result.status, 'sent'); assert.deepEqual(outgoing.to, ['leadchefreport@ocnyc.com', ...expected]); }
    else { assert.equal(result.status, 'failed'); assert.equal(outgoing, undefined); }
  }
});


test('authentication enforces the persisted Kitchen Lead role against old privileged tokens', async (t) => {
  env(t, 'JWT_SECRET', 'kitchen-lead-test-secret');
  const token = jwt.sign({ sub: chef.userId, role: 'admin', tokenVersion: 0 }, process.env.JWT_SECRET);
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ ...chef, _id: chef.userId, isActive: true, tokenVersion: 0 }) }) }));
  for (const path of ['/api/products', '/api/staff-portal/inventory', '/api/staff-portal/events']) {
    let passed = false;
    const res = { code: 200, status(code) { this.code = code; return this; }, json() {} };
    await requireAuth({ method: 'GET', originalUrl: path, headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
    assert.equal(passed, path === '/api/staff-portal/events');
    if (!passed) assert.equal(res.code, 403);
  }
});
