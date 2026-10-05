import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import router from '../routes/users.js';
import { requireAuth, requireAdmin, requireWorkspaceAccess, requireWorkspaceEditor, canSeeBarFinancials } from '../middleware/auth.js';
import { ACCOUNT_ROLES, invitationRolesFor, canSeeDepartmentFinancials } from '../utils/departmentAccess.js';

const id = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
const route = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const env = (t, key, value) => { const before = process.env[key]; process.env[key] = value; t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; }); };

test('department admins have operational access but never bar financials, even with stale permission flags', async () => {
  for (const role of ['kitchen admin', 'staffing admin']) {
    const auth = { role, seeBarFinancials: true, permissions: { seeBarFinancials: true } };
    const user = new User({ username: 'Department', email: 'department@example.com', role, password: 'hash', seeBarFinancials: true, permissions: { seeBarFinancials: true } });
    await user.validate();
    assert.equal(user.seeBarFinancials, false);
    assert.equal(user.permissions.seeBarFinancials, false);
    assert.equal(canSeeBarFinancials(auth), false);
    for (const guard of [requireAdmin, requireWorkspaceAccess, requireWorkspaceEditor]) {
      let passed = false;
      guard({ auth }, response(), () => { passed = true; });
      assert.equal(passed, true);
    }
    assert.equal(canSeeDepartmentFinancials(auth, 'kitchen'), role === 'kitchen admin');
    assert.equal(canSeeDepartmentFinancials(auth, 'staffing'), role === 'staffing admin');
    assert.equal(canSeeDepartmentFinancials(auth, 'bar'), false);
  }
  assert.equal(canSeeBarFinancials({ role: 'super admin' }), true);
});

test('persisted department roles restrict global administration on API and legacy paths despite old admin tokens', async (t) => {
  env(t, 'JWT_SECRET', 'test-department-secret');
  const token = jwt.sign({ sub: id, role: 'super admin', tokenVersion: 0 }, process.env.JWT_SECRET);
  for (const role of ['kitchen admin', 'staffing admin']) {
    t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: id, role, isActive: true, permissions: { seeBarFinancials: true } }) }) }));
    for (const [method, path, allowed] of [
      ['GET', '/api/events', true], ['POST', '/api/pages', true], ['GET', '/api/event-reports', true],
      ['GET', '/api/users', true], ['POST', '/api/users/invite', true], ['GET', '/api/users/invite-templates', true],
      ['POST', '/api/users', false], ['POST', '/users', false], ['GET', '/api/users/teams', false], ['PUT', '/users/teams/42', false],
      ['PUT', '/api/event-reports/settings', false], ['POST', '/api/integrations/caterease/financials/sync/42', false],
      ['GET', '/api/integrations/caterease/financial-preview/42', false],
      ['PATCH', `/api/users/${otherId}/see-bar-financials`, false],
      ['POST', '/api/integrations/dropbox/disconnect', false], ['GET', '/api/automation-alerts', false],
    ]) {
      let passed = false; const res = response();
      await requireAuth({ method, originalUrl: path, headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
      assert.equal(passed, allowed, `${role} ${method} ${path}`);
      if (!allowed) assert.equal(res.code, 403);
    }
  }
});

test('department user lists and invitation templates are limited to their employees', async (t) => {
  for (const [role, expected] of [['kitchen admin', ['kitchen lead', 'event staff']], ['staffing admin', ['captain', 'bar captain', 'bartender', 'uniform packer']]]) {
    t.mock.method(User, 'find', (query) => {
      assert.deepEqual(query, { role: { $in: expected } });
      return { select: async () => [] };
    });
    await route('/', 'get')({ auth: { role } }, response());
    const res = response();
    route('/invite-templates', 'get')({ auth: { role } }, res);
    assert.deepEqual(res.body.map((item) => item.role), expected);
  }
  assert.deepEqual(invitationRolesFor({ role: 'super admin' }), ACCOUNT_ROLES);
  assert.equal(invitationRolesFor({ role: 'admin' }).includes('super admin'), false);
  assert.deepEqual(invitationRolesFor({ role: 'kitchen lead' }), []);
});

test('department invites send personal registration links only for allowed roles; admin can invite every non-super role', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  const sent = []; let created;
  t.mock.method(User, 'findOne', () => ({ select: async () => null }));
  t.mock.method(User, 'create', async (payload) => { created = { ...payload, save: async () => {} }; return created; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'test-invite' }) }; });
  for (const [actor, role, code] of [
    ['kitchen admin', 'kitchen lead', 201], ['staffing admin', 'captain', 201],
    ['kitchen admin', 'captain', 403], ['staffing admin', 'kitchen lead', 403],
    ['kitchen admin', 'admin', 403], ['staffing admin', 'staffing admin', 403],
    ['admin', 'super admin', 403], ['super admin', 'super admin', 201],
    ...ACCOUNT_ROLES.filter((role) => role !== 'super admin').map((role) => ['admin', role, 201]),
  ]) {
    const before = sent.length; const res = response();
    await route('/invite', 'post')({ auth: { role: actor }, body: { username: 'Staff Member', email: 'person@example.com', role } }, res);
    assert.equal(res.code, code, `${actor} invites ${role}`);
    assert.equal(sent.length, before + (code === 201 ? 1 : 0));
    if (code === 201) {
      assert.equal(created.role, role); assert.equal(created.isActive, false);
      assert.deepEqual(sent.at(-1).to, ['person@example.com']);
      assert.match(sent.at(-1).text, /accept-invite\?token=/);
      if (role.endsWith('admin')) assert.doesNotMatch(sent.at(-1).text, /complete the event report|Bar Returns/);
    }
  }
});

test('department admins cannot modify, delete or reset passwords for another department or privileged accounts', async (t) => {
  for (const actor of ['kitchen admin', 'staffing admin']) {
    for (const targetRole of ['admin', 'super admin', 'kitchen admin', 'staffing admin', actor === 'kitchen admin' ? 'captain' : 'kitchen lead']) {
      t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: otherId, role: targetRole }) }));
      for (const [path, method, body] of [['/:id', 'patch', { username: 'changed' }], ['/:id', 'delete', {}], ['/:id/password', 'put', { password: 'new-password-123' }]]) {
        const res = response();
        await route(path, method)({ auth: { userId: id, role: actor }, params: { id: otherId }, body }, res);
        assert.equal(res.code, 403, `${actor} ${method} ${targetRole}`);
      }
    }
  }
});

test('department admins cannot promote their own employees or grant financial permissions', async (t) => {
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: otherId, role: 'kitchen lead' }) }));
  for (const body of [{ role: 'admin' }, { role: 'captain' }, { seeBarFinancials: true }, { permissions: { seeBarFinancials: true } }, { teamId: id }]) {
    const res = response();
    await route('/:id', 'patch')({ auth: { userId: id, role: 'kitchen admin' }, params: { id: otherId }, body }, res);
    assert.equal(res.code, 403);
  }
});

test('department admins can update their employees without changing access permissions', async (t) => {
  let saves = 0;
  const employee = { _id: otherId, role: 'kitchen lead', username: 'Chef', email: 'chef@example.com', permissions: { inventoryRead: false }, save: async () => { saves += 1; } };
  t.mock.method(User, 'findById', () => ({ select: async () => employee }));
  const res = response();
  await route('/:id', 'patch')({ auth: { userId: id, role: 'kitchen admin' }, params: { id: otherId }, body: { username: 'Chef Updated', nowstaName: 'Chef Updated' } }, res);
  assert.equal(res.code, 200);
  assert.equal(saves, 1);
  assert.equal(employee.username, 'Chef Updated');
  assert.deepEqual(employee.permissions, { inventoryRead: false });
});
