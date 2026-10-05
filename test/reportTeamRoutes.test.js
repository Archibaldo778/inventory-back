import test from 'node:test';
import assert from 'node:assert/strict';
import teamRouter from '../routes/reportTeams.js';
import reportRouter from '../routes/eventReports.js';
import userRouter from '../routes/users.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import Event from '../models/Event.js';

const salesId = '507f1f77bcf86cd799439011';
const memberId = '507f1f77bcf86cd799439012';
const teamId = '507f1f77bcf86cd799439013';
const eventId = '507f1f77bcf86cd799439014';
const sales = { _id: salesId, username: 'George Smith', email: 'george@example.com', isActive: true, role: 'user' };
const team = { _id: teamId, name: 'George', salesUserId: salesId, salesAliases: ['George'], reportDeliveryEnabled: true };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const mockDirectory = (t, teams = [team], users = [sales]) => {
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => teams }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => users }) }));
};

test('creating a team stores its responsible account and aliases without changing that user role', async (t) => {
  mockDirectory(t, []);
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => sales }) }));
  let saved;
  t.mock.method(ReportTeam, 'create', async (payload) => { saved = payload; return { _id: teamId, ...payload }; });
  const res = response();
  await handler(teamRouter, '/', 'post')({ params: {}, body: { name: 'George', salesUserId: salesId, salesAliases: ['George', 'George'], reportDeliveryEnabled: false } }, res);
  assert.equal(res.code, 201);
  assert.deepEqual(saved.salesAliases, ['George']);
  assert.equal(saved.salesUserId, salesId);
  assert.equal(sales.role, 'user');
});

test('saving a team rejects aliases already belonging to another team', async (t) => {
  const other = { _id: memberId, username: 'Other Sales', email: 'other@example.com', isActive: true };
  mockDirectory(t, [team], [sales, other]);
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => other }) }));
  const res = response();
  await handler(teamRouter, '/', 'post')({ params: {}, body: { name: 'Other', salesUserId: memberId, salesAliases: ['George'], reportDeliveryEnabled: true } }, res);
  assert.equal(res.code, 409);
});

test('team-manager profile is returned with full financial access without rewriting its stored role', async (t) => {
  const user = { _id: memberId, username: 'Megan', email: 'megan@example.com', role: 'user', isActive: true, save: async () => {} };
  t.mock.method(User, 'findById', () => ({ select: async () => user }));
  t.mock.method(ReportTeam, 'exists', async () => ({ _id: teamId }));
  const res = response();
  await handler(userRouter, '/:id', 'patch')({ params: { id: memberId }, auth: { role: 'admin' }, body: { jobTitle: 'team manager', teamId, receivesTeamReports: true } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.role, 'user');
  assert.equal(res.body.jobTitle, 'team manager');
  assert.equal(res.body.teamId, teamId);
  assert.equal(res.body.receivesTeamReports, true);
  assert.equal(res.body.seeBarFinancials, true);
});

test('event routing audit identifies missing Sales and gives the exact configured team recipients', async (t) => {
  mockDirectory(t);
  let query;
  t.mock.method(Event, 'find', (filter) => {
    query = filter;
    return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [
      { _id: eventId, title: 'Assigned', date: '2026-10-01', meta: { salesRep: 'George' } },
      { _id: memberId, title: 'Missing', date: '2026-10-01' },
      { _id: teamId, title: 'Test', date: '2026-10-01', meta: { eventReportTest: true } },
    ] }) }) }) };
  });
  const res = response();
  await handler(reportRouter, '/routing', 'get')({ query: { from: '2026-10-01', to: '2026-10-31' } }, res);
  assert.equal(res.code, 200);
  assert.equal(query['meta.nowsta.excluded'].$ne, true);
  assert.equal(res.body.events[0].routing.status, 'ready');
  assert.deepEqual(res.body.events[0].routing.recipients, ['george@example.com']);
  assert.equal(res.body.events[1].routing.status, 'blocked');
  assert.equal(res.body.events[2].routing.status, 'test');
});

test('assigning Sales to an event saves only the explicit report assignment and preserves other metadata', async (t) => {
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => sales }) }));
  t.mock.method(ReportTeam, 'findOne', () => ({ lean: async () => team }));
  let update;
  t.mock.method(Event, 'findByIdAndUpdate', (id, payload) => {
    assert.equal(id, eventId); update = payload;
    return { select: () => ({ lean: async () => ({ _id: eventId }) }) };
  });
  const res = response();
  await handler(reportRouter, '/events/:eventId/sales', 'patch')({ params: { eventId }, body: { salesUserId: salesId } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(update, { $set: { 'meta.reportSalesUserId': salesId, 'meta.reportSalesRep': 'George Smith' } });
  const reset = response();
  await handler(reportRouter, '/events/:eventId/sales', 'patch')({ params: { eventId }, body: { salesUserId: '' } }, reset);
  assert.equal(reset.code, 200);
  assert.deepEqual(update, { $unset: { 'meta.reportSalesUserId': '', 'meta.reportSalesRep': '' } });
});
