import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/Users.js';
import router from '../routes/users.js';
import { resolveUserInvitationSender, resolveAutomaticEmailSender } from '../utils/userInvitationSender.js';
import { renderUserInviteEmail } from '../utils/userInvitations.js';
import { renderUserInviteReminder } from '../utils/userInviteReminders.js';

const env = (t, key, value) => { const before = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; }); };
const handler = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('preview, invitation headers, signature and reminder metadata use the authenticated inviter, not submitted sender fields', async (t) => {
  env(t, 'RESEND_API_KEY', 'test-key');
  env(t, 'USER_INVITE_FROM', 'Old display name <invites@verified.example>');
  env(t, 'USER_INVITE_REPLY_TO', 'old-reply@example.com');
  let existing = null; let created; const messages = [];
  t.mock.method(User, 'findOne', () => ({ select: async () => existing }));
  t.mock.method(User, 'create', async (payload) => { created = { ...payload, save: async () => {} }; return created; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => { messages.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'mock-invite' }) }; });
  for (const auth of [
    { role: 'kitchen admin', username: 'Zia Sheikh', email: 'zia@example.com', invitedRole: 'kitchen lead' },
    { role: 'staffing admin', username: 'Sebastian Fajardo', email: 'sebastian@example.com', invitedRole: 'captain' },
    { role: 'super admin', username: 'Ivan', email: 'ivan@example.com', invitedRole: 'kitchen admin' },
  ]) {
    const preview = response();
    handler('/invite-templates', 'get')({ auth }, preview);
    assert.ok(preview.body.every((template) => template.text.includes(`Thank you,\n${auth.username}\n`)));
    for (const active of [false, true]) {
      existing = active ? { role: auth.invitedRole, isActive: true, username: 'Employee', password: 'existing-hash', save: async () => {} } : null;
      const res = response();
      await handler('/invite', 'post')({ auth, body: {
        username: 'Employee', email: 'employee@example.com', role: auth.invitedRole,
        sender: { name: 'Spoofed', email: 'spoofed@example.com' }, inviteSender: { name: 'Spoofed' },
      } }, res);
      assert.equal(res.code, 201);
      const message = messages.at(-1);
      assert.equal(message.from, `"${auth.username} at OCC" <invites@verified.example>`);
      assert.equal(message.reply_to, auth.email);
      assert.match(message.text, new RegExp(`Thank you,\\n${auth.username}\\n`));
      assert.ok(message.html.includes(`<strong>${auth.username}</strong>`));
      assert.doesNotMatch(JSON.stringify(message), /Spoofed|spoofed@example.com/);
      const saved = active ? existing : created;
      assert.deepEqual(saved.inviteSender, { name: auth.username, email: auth.email });
      if (active) assert.equal(saved.password, 'existing-hash');
      else {
        const model = new User(saved); await model.validate();
        assert.deepEqual(model.inviteSender.toObject(), saved.inviteSender);
      }
    }
  }
});

test('sender display names are quoted, header-safe and HTML-escaped while the verified mailbox is retained', (t) => {
  env(t, 'USER_INVITE_FROM', 'invites@verified.example');
  const sender = { username: 'Zia "Chef", A&B\r\nTeam', email: ' ZIA@EXAMPLE.COM ' };
  const identity = resolveUserInvitationSender(sender);
  assert.equal(identity.email, 'zia@example.com');
  assert.equal(identity.from, '"Zia \\"Chef\\", A&B Team at OCC" <invites@verified.example>');
  assert.doesNotMatch(identity.from, /[\r\n]/);
  const rendered = renderUserInviteEmail({ name: 'Chef', inviteUrl: 'https://example.com/invite', role: 'kitchen lead', sender });
  assert.match(rendered.html, /Zia &quot;Chef&quot;, A&amp;B Team/);
});

test('automated reminders use OCC Decks even when the original invitation was sent personally', (t) => {
  env(t, 'USER_INVITE_FROM', undefined);
  env(t, 'USER_INVITE_REPLY_TO', undefined);
  const user = { username: 'Employee', email: 'employee@example.com', inviteExpiresAt: new Date('2026-11-01T12:00:00Z') };
  const legacy = renderUserInviteReminder({ user, token: 'test-token' });
  assert.equal(legacy.from, 'OCC Decks <reports@reports.occdecks.com>');
  assert.equal(legacy.reply_to, 'staffing@ocnyc.com');
  user.inviteSender = { name: 'Ivan', email: 'ivan@example.com' };
  const current = renderUserInviteReminder({ user, token: 'test-token' });
  assert.equal(current.from, 'OCC Decks <reports@reports.occdecks.com>');
  assert.equal(current.reply_to, 'staffing@ocnyc.com');
  assert.match(current.text, /Thank you,\nOCC Decks\n/);
  assert.doesNotMatch(JSON.stringify(current), /ivan/i);
});

test('old personal sender configuration cannot brand system mail or fallback signatures as Ivan', (t) => {
  env(t, 'USER_INVITE_FROM', 'Ivan at OCC <invites@verified.example>');
  env(t, 'USER_INVITE_REPLY_TO', 'ivan@example.com');
  const sender = resolveAutomaticEmailSender();
  assert.equal(sender.from, 'OCC Decks <invites@verified.example>');
  assert.equal(sender.name, 'OCC Decks'); assert.equal(sender.email, 'staffing@ocnyc.com');
  assert.deepEqual(resolveUserInvitationSender(), sender);
  const message = renderUserInviteEmail({ name: 'Captain', inviteUrl: 'https://example.com/invite' });
  assert.doesNotMatch(JSON.stringify(message), /ivan/i); assert.doesNotMatch(message.text, /contact me directly/);
  const personal = resolveUserInvitationSender({ username: 'Ivan', email: 'ivan@example.com' });
  assert.equal(personal.from, '"Ivan at OCC" <invites@verified.example>'); assert.equal(personal.email, 'ivan@example.com');
});
