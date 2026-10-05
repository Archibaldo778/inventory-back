import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/Users.js';
import ReportTeam from '../models/ReportTeam.js';
import userRouter from '../routes/users.js';
import { userTeamProfile } from '../utils/userTeamProfile.js';
import { isAdminAuth, canManageInventory, canAccessProposals, canSeeBarFinancials } from '../middleware/auth.js';

const salesId = '507f1f77bcf86cd799439011';
const memberId = '507f1f77bcf86cd799439012';
const teamId = '507f1f77bcf86cd799439013';
const sales = { _id: salesId, username: 'Olivier', role: 'sales rep', isActive: true };
const mockSales = (t, person = sales) => t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => person }) }));

test('choosing Sales creates one reusable team without enabling deliveries or changing Sales permissions', async (t) => {
  mockSales(t);
  let stored; let created = 0;
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => stored }));
  t.mock.method(ReportTeam, 'findOneAndUpdate', async (query, update, options) => {
    assert.deepEqual(query, { salesUserId: salesId });
    assert.equal(options.upsert, true); created++;
    stored = { _id: teamId, ...update.$setOnInsert }; return stored;
  });
  for (let i = 0; i < 3; i++) {
    const profile = await userTeamProfile({ jobTitle: 'assistant', worksWithUserId: salesId, receivesTeamReports: false });
    assert.equal(String(profile.teamId), teamId);
  }
  assert.equal(created, 1);
  assert.equal(stored.name, 'Olivier');
  assert.equal(stored.reportDeliveryEnabled, false);
  assert.equal(sales.role, 'sales rep');
});

test('existing teams keep their name, routing settings and aliases', async (t) => {
  mockSales(t);
  const team = { _id: teamId, salesUserId: salesId, name: 'Existing', salesAliases: ['Oliver'], reportDeliveryEnabled: true };
  const before = structuredClone(team);
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => team }));
  t.mock.method(ReportTeam, 'findOneAndUpdate', async () => assert.fail('Existing team must not be changed'));
  const profile = await userTeamProfile({ worksWithUserId: salesId }, { receivesTeamReports: true, teamId });
  assert.equal(profile.teamId, teamId);
  assert.deepEqual(team, before);
});

test('invalid, self, inactive and non-Sales assignments are rejected', async (t) => {
  await assert.rejects(userTeamProfile({ worksWithUserId: '' }), /Choose the Sales/);
  await assert.rejects(userTeamProfile({ worksWithUserId: salesId }, { _id: salesId }), /another person/);
  const lookup = mockSales(t, { ...sales, isActive: false });
  await assert.rejects(userTeamProfile({ worksWithUserId: salesId }), /active Sales/);
  lookup.mock.mockImplementation(() => ({ select: () => ({ lean: async () => ({ ...sales, role: 'captain' }) }) }));
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => null }));
  await assert.rejects(userTeamProfile({ worksWithUserId: salesId }), /Choose a Sales/);
});

test('simultaneous assignments reuse the team created by the other request', async (t) => {
  mockSales(t); let reads = 0;
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => ++reads === 1 ? null : { _id: teamId } }));
  t.mock.method(ReportTeam, 'findOneAndUpdate', async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  assert.equal((await userTeamProfile({ worksWithUserId: salesId })).teamId, teamId);
});

const edit = userRouter.stack.find((layer) => layer.route?.path === '/:id' && layer.route.methods.patch).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('saving Sales Assistant grants the requested full access and returns the selected membership', async (t) => {
  const member = { _id: memberId, username: 'Assistant', email: 'assistant@example.com', role: 'user', save: async () => {} };
  t.mock.method(User, 'findById', (id) => ({ select: () => String(id) === salesId ? { lean: async () => sales } : Promise.resolve(member) }));
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => ({ _id: teamId }) }));
  const res = response();
  await edit({ params: { id: memberId }, auth: { role: 'admin' }, body: {
    role: 'admin', jobTitle: 'assistant', worksWithUserId: salesId, seeBarFinancials: true, seeProposals: true,
  } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.jobTitle, 'assistant');
  assert.equal(res.body.teamId, teamId);
  for (const check of [isAdminAuth, canManageInventory, canAccessProposals, canSeeBarFinancials]) assert.equal(check(res.body), true);
});

test('department administrators cannot grant the Sales full-access preset', async (t) => {
  t.mock.method(User, 'findById', () => ({ select: async () => ({ _id: memberId, role: 'kitchen lead' }) }));
  const res = response();
  await edit({ params: { id: memberId }, auth: { role: 'kitchen admin' }, body: { role: 'admin', jobTitle: 'assistant', worksWithUserId: salesId } }, res);
  assert.equal(res.code, 403);
});
