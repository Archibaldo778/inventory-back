import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamDeliveryPlan, resolveTeamRouting } from '../utils/reportTeams.js';
import { userTeamProfile } from '../utils/userTeamProfile.js';
import { sendEventReportEmail } from '../utils/eventReportEmail.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';

const team = { _id: 'team-1', name: 'OCC', salesUserId: 'sales-1', salesAliases: ['Oliver Cheng'], reportDeliveryEnabled: true };
const users = [
  { _id: 'sales-1', username: 'Olivier Cheng', email: 'sales@example.com', isActive: true, role: 'user' },
  { _id: 'member-1', username: 'Sebastian', email: 'assistant@example.com', teamId: 'team-1', receivesTeamReports: true, role: 'user' },
  { _id: 'member-2', username: 'Not subscribed', email: 'off@example.com', teamId: 'team-1', receivesTeamReports: false },
  { _id: 'member-3', username: 'Other team', email: 'other@example.com', teamId: 'team-2', receivesTeamReports: true },
];

test('team recipients include its Sales and opted-in members without granting access roles', () => {
  const before = structuredClone(users);
  const plan = buildTeamDeliveryPlan(team, users);
  assert.deepEqual(plan.recipients, ['sales@example.com', 'assistant@example.com']);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(users, before);
});

test('aliases match exactly and explicit Sales account IDs survive a renamed user', () => {
  const directory = { teams: [team], users };
  assert.equal(resolveTeamRouting({ salesRep: '  OLIVER CHENG ', ...directory }).status, 'ready');
  assert.equal(resolveTeamRouting({ salesRep: 'Oliver', ...directory }).status, 'legacy');
  assert.equal(resolveTeamRouting({ event: { meta: { reportSalesUserId: 'sales-1' } }, salesRep: 'Old Name', ...directory }).teamId, 'team-1');
  assert.equal(resolveTeamRouting({ event: { meta: { reportSalesUserId: 'missing' } }, ...directory }).status, 'blocked');
});

test('missing Sales, ambiguous teams and incomplete addresses are visible routing errors', () => {
  assert.equal(resolveTeamRouting({ event: {}, teams: [team], users }).status, 'blocked');
  assert.equal(resolveTeamRouting({ salesRep: 'Oliver Cheng', teams: [team, { ...team, _id: 'duplicate' }], users }).status, 'blocked');
  const incomplete = users.map((user) => user._id === 'member-1' ? { ...user, email: '' } : user);
  const plan = resolveTeamRouting({ salesRep: 'Oliver Cheng', teams: [team], users: incomplete });
  assert.equal(plan.status, 'blocked');
  assert.match(plan.issues.join(' '), /Sebastian: valid email/);
  const inactive = users.map((user) => user._id === 'sales-1' ? { ...user, isActive: false } : user);
  assert.match(buildTeamDeliveryPlan(team, inactive).issues.join(' '), /account is inactive/);
});

test('teams require explicit activation and recipient opt-out applies immediately', () => {
  assert.equal(resolveTeamRouting({ salesRep: 'Oliver Cheng', teams: [{ ...team, reportDeliveryEnabled: false }], users }).status, 'legacy');
  const incompleteSetup = resolveTeamRouting({ salesRep: 'Oliver Cheng', teams: [{ ...team, reportDeliveryEnabled: false }], users: [] });
  assert.equal(incompleteSetup.status, 'legacy');
  assert.ok(incompleteSetup.issues.includes('Sales account is missing'));
  const next = users.map((user) => ({ ...user, receivesTeamReports: false }));
  assert.deepEqual(buildTeamDeliveryPlan(team, next).recipients, ['sales@example.com']);
});

test('updating job and team fields preserves access roles and existing fields when omitted', async (t) => {
  t.mock.method(ReportTeam, 'exists', async () => ({ _id: '507f1f77bcf86cd799439011' }));
  const current = { role: 'user', teamId: null, receivesTeamReports: false };
  const changes = await userTeamProfile({ jobTitle: 'team manager', teamId: '507f1f77bcf86cd799439011', receivesTeamReports: true }, current);
  assert.equal(changes.jobTitle, 'team manager');
  assert.equal(changes.receivesTeamReports, true);
  assert.equal({ ...current, ...changes }.role, 'user');
  assert.deepEqual(await userTeamProfile({}, { teamId: changes.teamId, receivesTeamReports: true }), {});
  await assert.rejects(userTeamProfile({ jobTitle: 'admin' }), /Choose Sales/);
  await assert.rejects(userTeamProfile({ receivesTeamReports: true }), /Select a team/);
  await assert.rejects(userTeamProfile({ receivesTeamReports: 'true' }), /on or off/);
  await assert.rejects(userTeamProfile({ teamId: 'bad-id' }), /existing team/);
});

test('user model allows organizational fields without changing the access role', async () => {
  const user = new User({ username: 'Sebastian', email: 'sebastian@example.com', password: 'test-hash', role: 'user', jobTitle: 'team manager', receivesTeamReports: true, teamId: '507f1f77bcf86cd799439011' });
  await user.validate();
  assert.equal(user.role, 'user');
  assert.equal(user.jobTitle, 'team manager');
  assert.equal(user.seeBarFinancials, false);
});

test('enabled team delivery uses account emails, bypasses Slack and keeps central mailbox and captain CC', async (t) => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; });
  let sent;
  const result = await sendEventReportEmail({
    report: { reportType: 'captain', salesRep: 'Oliver Cheng', reporterEmail: 'captain@example.com' }, event: {},
    loadTeams: async () => ({ teams: [team], users }),
    loadSlackUsers: async () => { assert.fail('Configured teams must not depend on Slack'); },
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'team-email' }) }; },
  });
  assert.equal(result.status, 'sent');
  assert.deepEqual(sent.to, ['captainreport@ocnyc.com', 'sales@example.com', 'assistant@example.com']);
  assert.deepEqual(sent.cc, ['captain@example.com']);
});

test('missing event Sales or a broken configured team cannot silently send to the old recipients', async () => {
  for (const salesRep of ['', 'Oliver Cheng']) {
    const result = await sendEventReportEmail({
      report: { reportType: 'captain', salesRep }, event: {},
      loadTeams: async () => ({ teams: [team], users: [] }),
      fetchImpl: async () => { assert.fail('Incomplete routing must not send'); },
    });
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
  }
});
