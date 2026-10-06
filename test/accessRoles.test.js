import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import AccessRole from '../models/AccessRole.js';
import User from '../models/Users.js';
import router, { requireRoleOwner } from '../routes/accessRoles.js';
import { requireAuth, requireAdmin, canSeeBarFinancials } from '../middleware/auth.js';
import { isRoleOwner, protectedAccountChange } from '../utils/roleOwners.js';
import { roleKeyForUser, validateRoleChanges } from '../utils/accessRoleCatalog.js';
import { requestPermission, permissionValue } from '../utils/accessRolePolicy.js';
import { canEditReportTemplate } from '../routes/eventReportTemplates.js';
import { canViewEvent } from '../routes/bar.js';
import userRouter from '../routes/users.js';

const owner = { userId: '68c70548aea053de74d25b22', role: 'super admin' };
const iurie = { userId: '68c7047faea053de74d25b15', role: 'admin' };
const captain = { userId: '6ac51f12caed1c8144b1f327', role: 'captain', username: 'Iurie Scurtul' };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });

test('only verified administrative identities manage roles; names, emails and admin role cannot impersonate them', () => {
  assert.equal(isRoleOwner({ _id: owner.userId.toUpperCase() }), true);
  for (const auth of [owner, iurie]) {
    let next = false;
    requireRoleOwner({ auth }, response(), () => { next = true; });
    assert.equal(next, true);
  }
  for (const auth of [captain, { userId: 'other', role: 'super admin', username: 'Ivan', email: 'ivan@ocnyc.com' }, { username: 'Iurie', role: 'admin' }]) {
    const res = response(); requireRoleOwner({ auth }, res, () => assert.fail('unexpected access'));
    assert.equal(res.code, 403);
    assert.equal(isRoleOwner(auth), false);
  }
});

test('neither owner can be deleted through an uppercase MongoDB identifier', async () => {
  const handler = userRouter.stack.find((layer) => layer.route?.path === '/:id' && layer.route.methods.delete).route.stack.at(-1).handle;
  for (const target of [owner, iurie]) {
    const res = response();
    await handler({ auth: owner, params: { id: target.userId.toUpperCase() } }, res);
    assert.equal(res.code, 403);
    assert.match(res.body.message, /cannot be deleted/);
  }
});

test('owner protection prevents disabling and changing either owner, including string false', () => {
  const target = { _id: iurie.userId, role: 'admin', jobTitle: '' };
  for (const changes of [{ role: 'captain' }, { isActive: false }, { active: 'false' }, { jobTitle: 'assistant' }]) {
    assert.ok(protectedAccountChange(target, changes, owner));
  }
  assert.ok(protectedAccountChange(target, { password: 'replacement' }, captain));
  assert.equal(protectedAccountChange(target, { username: 'Iurie' }, owner), '');
});

test('positions reuse current access roles, while captain identity never inherits administrative access', () => {
  assert.equal(roleKeyForUser({ role: 'sales rep' }), 'sales');
  assert.equal(roleKeyForUser({ role: 'admin', jobTitle: 'assistant' }), 'assistant');
  assert.equal(roleKeyForUser({ role: 'user', jobTitle: 'team manager' }), 'team manager');
  assert.equal(roleKeyForUser({ ...captain, jobTitle: 'assistant' }), 'captain');
});

test('section restrictions reject direct mutations and invitation/report/sync actions separately', () => {
  const auth = { accessPermissions: { 'events.view': true, 'events.edit': false, 'users.view': true, 'users.edit': true,
    'users.invite': false, 'reports.view': true, 'reports.edit': true, 'reports.send': false, 'integrations.sync': false } };
  assert.equal(requestPermission(auth, { originalUrl: '/api/events/123', method: 'GET' }), true);
  for (const url of ['/api/events/123', '/API/Events/123', '/api/users/invite', '/USERS/invite', '/api/event-reports/123/email', '/api/events/nowsta/sync', '/api/assistant', '/API/ASSISTANT']) {
    assert.equal(requestPermission(auth, { originalUrl: url, method: 'POST' }), false, url);
  }
  assert.equal(requestPermission({ role: 'admin' }, { originalUrl: '/api/events/123', method: 'PATCH' }), undefined);
  assert.equal(permissionValue({ ...owner, accessPermissions: { 'events.view': false } }, 'events.view'), true);
});

test('role validation rejects arbitrary grants and edit without view', () => {
  assert.throws(() => validateRoleChanges({ name: 'Role', permissions: { manageRoles: true } }));
  assert.throws(() => validateRoleChanges({ name: 'Role', permissions: { 'events.view': false, 'events.edit': true } }));
  assert.deepEqual(validateRoleChanges({ name: ' Reader ', permissions: { 'events.view': true, 'events.edit': false } }),
    { name: 'Reader', permissions: { 'events.view': true, 'events.edit': false } });
});

test('template permissions keep both departmental templates visible without granting both edits', () => {
  for (const role of ['staffing admin', 'kitchen admin']) {
    assert.equal(canEditReportTemplate({ role }, 'captain'), role === 'staffing admin');
    assert.equal(canEditReportTemplate({ role }, 'kitchen'), role === 'kitchen admin');
  }
  for (const auth of [owner, iurie]) for (const type of ['captain', 'kitchen']) assert.equal(canEditReportTemplate(auth, type), true);
  assert.equal(canEditReportTemplate({ role: 'admin', accessPermissions: { 'captainTemplate.edit': false } }, 'captain'), false);
});

test('permission changes are read on every authenticated request, overriding a stale privileged token', async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'role-policy-test';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const user = { _id: '507f1f77bcf86cd799439011', role: 'admin', isActive: true };
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => user }) }));
  let allowed = true;
  t.mock.method(AccessRole, 'findById', () => ({ select: () => ({ lean: async () => ({ baseRole: 'admin', permissions: { 'events.view': allowed } }) }) }));
  const token = jwt.sign({ sub: user._id, role: 'super admin' }, process.env.JWT_SECRET);
  const run = async () => {
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: '/api/events', method: 'GET' };
    const res = response(); let next = false;
    await requireAuth(req, res, () => { requireAdmin(req, res, () => { next = true; }); });
    return { res, next };
  };
  assert.equal((await run()).next, true);
  allowed = false;
  const revoked = await run(); assert.equal(revoked.next, false); assert.equal(revoked.res.code, 403);
});

test('saving role permissions writes audit with the same atomic revision check; stale editor cannot overwrite it', async (t) => {
  const current = { _id: 'admin', name: 'Admin', baseRole: 'admin', permissions: {}, revision: 3 };
  t.mock.method(AccessRole, 'findById', () => ({ lean: async () => current }));
  let update;
  t.mock.method(AccessRole, 'findOneAndUpdate', async (filter, changes) => { update = { filter, changes }; return { ...current, revision: 4 }; });
  const handler = router.stack.find((layer) => layer.route?.path === '/:id' && layer.route.methods.put).route.stack.at(-1).handle;
  const req = { auth: owner, params: { id: 'admin' }, body: { name: 'Admin', permissions: { 'events.edit': false }, expectedRevision: 3 } };
  const res = response(); await handler(req, res);
  assert.equal(res.code, 200); assert.equal(update.filter.revision, 3);
  assert.equal(update.changes.$push.audit.actorId, owner.userId);
  assert.deepEqual(update.changes.$push.audit.before.permissions, {});
  assert.deepEqual(update.changes.$push.audit.after.permissions, { 'events.edit': false });
  update = null; req.body.expectedRevision = 2; const stale = response(); await handler(req, stale);
  assert.equal(stale.code, 409); assert.equal(update, null);
});

test('granting My Events never turns a captain into a bar manager or reveals another event', async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'assigned-policy-test';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const user = { _id: captain.userId, role: 'captain', isActive: true };
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => user }) }));
  t.mock.method(AccessRole, 'findById', () => ({ select: () => ({ lean: async () => ({ baseRole: 'captain', permissions: { 'myEvents.view': true } }) }) }));
  const token = jwt.sign({ sub: user._id }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: '/api/bar/events', method: 'GET' };
  await requireAuth(req, response(), () => {});
  assert.equal(req.auth.sectionAccess, false);
  assert.equal(canViewEvent({ assignedUserIds: [captain.userId] }, req.auth), true);
  assert.equal(canViewEvent({ assignedUserIds: [owner.userId] }, req.auth), false);
});

test('assigning a custom access role preserves the operational captain role and audits the assignment', async (t) => {
  const customId = 'custom-11111111-1111-1111-1111-111111111111';
  const user = new User({ _id: captain.userId, username: 'Test Captain', email: 'captain@example.com', password: 'hash', role: 'captain' });
  t.mock.method(User, 'findById', () => ({ select: () => user }));
  t.mock.method(AccessRole, 'findById', () => ({ lean: async () => ({ _id: customId, name: 'Event Captain', baseRole: 'captain' }) }));
  t.mock.method(user, 'save', async () => user);
  const handler = userRouter.stack.find((layer) => layer.route?.path === '/:id' && layer.route.methods.patch).route.stack.at(-1).handle;
  const res = response();
  await handler({ auth: owner, params: { id: captain.userId }, body: { role: customId, jobTitle: '' } }, res);
  assert.equal(res.code, 200);
  assert.equal(user.role, 'captain');
  assert.equal(user.accessRoleId, customId);
  assert.equal(res.body.accessRoleId, customId);
  assert.equal(user.accessAudit.at(-1).after.accessRoleId, customId);
  assert.equal(user.accessAudit.at(-1).actorId, owner.userId);
});

test('a section grant permits only that section and never grants role management or financial access', async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'bounded-policy-test';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const user = { _id: '507f1f77bcf86cd799439011', role: 'user', isActive: true };
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => user }) }));
  t.mock.method(AccessRole, 'findById', () => ({ select: () => ({ lean: async () => ({ baseRole: 'user', permissions: { 'venues.view': true, 'venues.edit': false } }) }) }));
  const token = jwt.sign({ sub: user._id, canManageRoles: true, accessPermissions: { 'users.view': true } }, process.env.JWT_SECRET);
  for (const [path, method, allowed] of [['/api/venues', 'GET', true], ['/api/venues', 'POST', false], ['/api/users', 'GET', false]]) {
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: path, method };
    const res = response(); let next = false;
    await requireAuth(req, res, () => requireAdmin(req, res, () => { next = true; }));
    assert.equal(next, allowed, path + method);
    if (req.auth) {
      assert.equal(req.auth.canManageRoles, false);
      assert.equal(canSeeBarFinancials(req.auth), false);
    }
  }
});
