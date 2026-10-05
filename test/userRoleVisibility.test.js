import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/Users.js';
import router from '../routes/users.js';

const id = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const route = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

test('user directory presents super admins as admins to other administrators without changing stored roles', async (t) => {
  const users = [{ _id: id, username: 'Owner', role: 'super admin' }, { _id: otherId, username: 'Office', role: 'admin' }];
  t.mock.method(User, 'find', () => ({ select: async () => users }));
  for (const role of ['admin', 'bar admin', 'super admin']) {
    const res = response();
    await route('/', 'get')({ auth: { role, userId: otherId } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body[0].role, role === 'super admin' ? 'super admin' : 'admin');
    assert.equal(res.body[1].role, 'admin');
    if (role !== 'super admin') assert.doesNotMatch(JSON.stringify(res.body), /super.?admin/i);
  }
  assert.equal(users[0].role, 'super admin');
});

test('a masked owner remains protected from edits, password changes and deletion by ordinary admins', async (t) => {
  const owner = { _id: id, role: 'super admin' };
  t.mock.method(User, 'findById', () => ({ select: async () => owner }));
  t.mock.method(User, 'findByIdAndUpdate', () => assert.fail('Protected account must not be updated'));
  t.mock.method(User, 'findByIdAndDelete', () => assert.fail('Protected account must not be deleted'));
  for (const [path, method, body] of [
    ['/:id', 'patch', { role: 'admin', username: 'Changed' }],
    ['/:id/see-bar-financials', 'patch', { seeBarFinancials: false }],
    ['/:id/password', 'put', { password: 'new-password' }],
    ['/:id', 'delete', {}],
  ]) {
    const res = response();
    await route(path, method)({ auth: { role: 'admin', userId: otherId }, params: { id }, body }, res);
    assert.equal(res.code, 403);
    assert.doesNotMatch(JSON.stringify(res.body), /super.?admin/i);
  }
  assert.equal(owner.role, 'super admin');
});

test('an ordinary administrator cannot use account editing to grant themselves super admin', async (t) => {
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: id, role: 'admin' }) }));
  const res = response();
  await route('/:id', 'patch')({ auth: { role: 'admin', userId: id }, params: { id }, body: { role: 'super admin' } }, res);
  assert.equal(res.code, 403);
});

test('the owner still sees the Super Admin invitation option while ordinary admins do not', () => {
  for (const role of ['admin', 'super admin']) {
    const res = response();
    route('/invite-templates', 'get')({ auth: { role } }, res);
    assert.equal(res.body.some((template) => template.role === 'super admin'), role === 'super admin');
  }
});
