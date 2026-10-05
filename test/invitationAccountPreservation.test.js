import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/Users.js';
import router from '../routes/users.js';
import { sendUserInviteEmail } from '../utils/userInvitations.js';
const invite = router.stack.find((layer) => layer.route?.path === '/invite').route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const key = (t) => { const old = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 'test'; t.after(() => { if (old === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = old; }); };

test('repeat invitations preserve account names and role unless an authorized caller explicitly changes the role', async (t) => {
  key(t);
  let user; const messages = [];
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'sent' }) }; });
  for (const active of [true, false]) {
    for (const flag of [undefined, false, 'true', true]) {
      user = { _id: 'account', role: 'bar captain', username: 'Original Name', nowstaName: 'Nowsta Name', isActive: active, tokenVersion: 3, save: async () => {} };
      const res = response();
      await invite({ auth: { role: 'admin' }, body: { username: 'Replacement Name', nowstaName: 'Replacement Nowsta', email: 'captain@example.com', role: 'captain', changeRole: flag } }, res);
      assert.equal(res.code, 201);
      assert.equal(user.role, flag === true ? 'captain' : 'bar captain');
      assert.equal(user.tokenVersion, flag === true ? 4 : 3);
      assert.equal(user.username, 'Original Name');
      assert.equal(user.nowstaName, 'Nowsta Name');
      assert.match(messages.at(-1).text, /Hi Original Name/);
      assert.equal(messages.at(-1).text.includes('Bar Returns'), flag !== true);
    }
  }
  for (const [actor, current, target] of [['staffing admin', 'kitchen lead', 'captain'], ['admin', 'super admin', 'captain'], ['kitchen admin', 'kitchen lead', 'admin']]) {
    user = { _id: 'account', role: current, username: 'Name', isActive: true, save: async () => { throw new Error('Must not save'); } };
    const before = messages.length; const res = response();
    await invite({ auth: { role: actor }, body: { username: 'Name', email: 'staff@example.com', role: target, changeRole: true } }, res);
    assert.equal(res.code, 403);
    assert.equal(user.role, current);
    assert.equal(messages.length, before);
  }
});

test('CC notification has no credential and its failure does not retry a delivered invitation', async (t) => {
  key(t);
  const token = 'private-secret-credential';
  for (const failure of ['http', 'network']) {
    const messages = [];
    const delivery = await sendUserInviteEmail({ email: 'staff@example.com', name: 'Chef', inviteUrl: `https://example.com/accept-invite?token=${token}`, cc: ['manager@example.com'], fetchImpl: async (_url, options) => {
      messages.push(JSON.parse(options.body));
      if (messages.length === 2 && failure === 'network') throw new Error('Network error');
      return { ok: messages.length === 1, status: 500, json: async () => messages.length === 1 ? { id: 'invitation-sent' } : { message: 'failed' } };
    } });
    assert.equal(delivery.status, 'sent');
    assert.equal(delivery.copyDelivery.status, 'failed');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].cc, undefined);
    assert.ok(messages[0].text.includes(token));
    assert.doesNotMatch(JSON.stringify(messages[1]), /private-secret-credential|accept-invite|token=/);
  }
});
