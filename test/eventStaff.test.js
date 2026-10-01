import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import Product from '../models/Product.js';
import Event from '../models/Event.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import router from '../routes/staffPortal.js';
import userRouter from '../routes/users.js';
import { requireAuth, canAccessWorkspace, canManageInventory } from '../middleware/auth.js';
import { canReadStaffInventory, eventStaffRequestAllowed } from '../utils/eventStaffAccess.js';
import { workerMatchesStaff, staffScheduleQuery, serializeStaffEvent } from '../utils/staffPortal.js';

const userId = '507f1f77bcf86cd799439011';
const user = { _id: userId, userId, username: 'Maye', nowstaName: 'Maye La Monica', email: 'maye@example.com', role: 'event staff', permissions: { inventoryRead: true } };
const worker = { name: 'Maye La Monica', email: 'maye@example.com', status: 'confirmed' };
const entry = { nowstaEventId: '123', title: 'Dinner', date: '2026-10-01', archived: false, notes: 'Private admin notes', shifts: [
  { position: 'Executive Chef', startTime: '12:00 PM', endTime: '9:00 PM', workers: [worker, { name: 'Other', email: 'other@example.com', phone: '555', status: 'confirmed' }] },
] };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (source, path, method = 'get') => source.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

test('Event Staff has a read-only allowlist and never gains general workspace or inventory editing', () => {
  assert.equal(canAccessWorkspace(user), false);
  assert.equal(canManageInventory(user), false);
  for (const originalUrl of ['/api/staff-portal/events', '/api/staff-portal/events/123?x=1', '/api/staff-portal/inventory']) {
    assert.equal(eventStaffRequestAllowed(user, { method: 'GET', originalUrl }), true);
    assert.equal(eventStaffRequestAllowed(user, { method: 'POST', originalUrl }), false);
  }
  for (const originalUrl of ['/api/events', '/api/events/other', '/api/products', '/api/users', '/api/bar/events', '/api/notifications', '/api/integrations/caterease/operations/events/other', '/api/integrations/dropbox/activity']) {
    assert.equal(eventStaffRequestAllowed(user, { method: 'GET', originalUrl }), false);
  }
  assert.equal(eventStaffRequestAllowed(user, { method: 'PUT', originalUrl: `/api/users/${userId}/password` }), true);
  assert.equal(eventStaffRequestAllowed(user, { method: 'PUT', originalUrl: '/api/users/other/password' }), false);
  assert.equal(eventStaffRequestAllowed({ role: 'user' }, { method: 'GET', originalUrl: '/api/events' }), true);
});

test('inventory permission is explicit for staff and can later be enabled independently for captains', () => {
  for (const role of ['event staff', 'captain', 'bar captain']) {
    assert.equal(canReadStaffInventory({ ...user, role }), true);
    assert.equal(canReadStaffInventory({ role, permissions: { inventoryRead: false } }), false);
    assert.equal(canReadStaffInventory({ role }), false);
  }
  assert.equal(eventStaffRequestAllowed({ ...user, permissions: {} }, { method: 'GET', originalUrl: '/api/staff-portal/inventory' }), false);
});

test('Nowsta assignment matches exact email or full name without granting access on a partial name or declined shift', () => {
  assert.equal(workerMatchesStaff({ ...worker, name: 'Renamed', email: 'MAYE@example.com' }, user), true);
  assert.equal(workerMatchesStaff({ ...worker, email: '', name: ' Maye  La Monica ' }, user), true);
  assert.equal(workerMatchesStaff({ ...worker, email: '', name: 'Maye' }, user), false);
  assert.equal(workerMatchesStaff({ ...worker, email: 'different@example.com' }, user), false);
  for (const status of ['declined', 'pending', 'removed', '']) assert.equal(workerMatchesStaff({ ...worker, status }, user), false);
  assert.equal(workerMatchesStaff({ ...worker, status: 'assigned' }, user), true);
  assert.equal(staffScheduleQuery(user).archived.$ne, true);
});

test('event projection exposes only the assigned shifts and no private notes or other workers', () => {
  const visible = serializeStaffEvent(entry, user);
  assert.equal(visible.title, 'Dinner');
  assert.deepEqual(visible.shifts, [{ position: 'Executive Chef', startTime: '12:00 PM', endTime: '9:00 PM' }]);
  assert.equal(visible.notes, undefined);
  assert.equal(serializeStaffEvent({ ...entry, archived: true }, user), null);
  assert.equal(serializeStaffEvent({ ...entry, shifts: [] }, user), null);
});

test('event list and direct links reject unassigned, removed and archived events', async (t) => {
  t.mock.method(Event, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  let selected = entry;
  let query;
  t.mock.method(NowstaScheduleEntry, 'find', (filter) => {
    query = filter;
    return { select: () => ({ sort: () => ({ lean: async () => [entry, { ...entry, nowstaEventId: 'other', shifts: [] }, { ...entry, archived: true }] }) }) };
  });
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => selected }) }));
  const res = response();
  await handler(router, '/events')({ auth: user, query: { from: '2026-10-01', to: '2026-10-31' } }, res);
  assert.deepEqual(res.body.items.map((event) => event.id), ['123']);
  assert.ok(query['shifts.workers'].$elemMatch);
  assert.deepEqual(query.date, { $gte: '2026-10-01', $lte: '2026-10-31' });
  t.mock.method(NowstaScheduleEntry, 'find', (filter) => {
    query = filter;
    return { select: () => ({ sort: () => ({ lean: async () => [
      { ...entry, nowstaEventId: 'past', date: '2025-01-01' }, entry,
      { ...entry, nowstaEventId: 'other', shifts: [] }, { ...entry, archived: true },
    ] }) }) };
  });
  const allDates = response();
  await handler(router, '/events')({ auth: user, query: { view: 'all' } }, allDates);
  assert.equal(query.date, undefined);
  assert.ok(query['shifts.workers'].$elemMatch);
  assert.equal(query.archived.$ne, true);
  assert.deepEqual(allDates.body.items.map((event) => event.id), ['past', '123']);
  for (selected of [null, { ...entry, shifts: [] }, { ...entry, archived: true }]) {
    const denied = response();
    await handler(router, '/events/:id')({ auth: user, params: { id: '123' } }, denied);
    assert.equal(denied.code, 404);
  }
  selected = entry;
  const allowed = response();
  await handler(router, '/events/:id')({ auth: user, params: { id: '123' } }, allowed);
  assert.equal(allowed.code, 200);
});

test('chef event list and detail use linked Caterease guests without exposing other event data', async (t) => {
  const assigned = { ...entry, guestCount: 0 };
  t.mock.method(NowstaScheduleEntry, 'find', () => ({ select: () => ({ sort: () => ({ lean: async () => [assigned] }) }) }));
  t.mock.method(NowstaScheduleEntry, 'findOne', () => ({ select: () => ({ lean: async () => assigned }) }));
  let linked = [{ meta: { nowsta: { apiEventId: '123' }, guestCount: 0 }, catereaseOperations: { guestCount: 180 }, client: 'Private client' }];
  t.mock.method(Event, 'find', (query) => {
    assert.deepEqual(query['meta.nowsta.apiEventId'], { $in: ['123'] });
    assert.equal(query['meta.nowsta.excluded'].$ne, true);
    assert.equal(query.status.$not.test('cancelled'), true);
    return { select: () => ({ lean: async () => linked }) };
  });
  for (const [path, req] of [
    ['/events', { query: { view: 'all' } }],
    ['/events/:id', { params: { id: '123' } }],
  ]) {
    const res = response();
    await handler(router, path)({ auth: user, ...req }, res);
    const visible = res.body.items?.[0] || res.body;
    assert.equal(visible.guestCount, 180);
    assert.equal(visible.catereaseOperations, undefined);
    assert.notEqual(visible.client, 'Private client');
  }
  linked = [];
  for (const guestCount of [95, null]) {
    assigned.guestCount = guestCount;
    const res = response();
    await handler(router, '/events/:id')({ auth: user, params: { id: '123' } }, res);
    assert.equal(res.body.guestCount, guestCount);
  }
});

test('staff portal rejects malformed date ranges without querying the database', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'find', () => assert.fail('Invalid date must not query'));
  for (const from of ['invalid', '2026-99-01', '2026-02-30', '2028-01-01']) {
    const res = response();
    await handler(router, '/events')({ auth: user, query: { from, to: '2026-12-01' } }, res);
    assert.equal(res.code, 400);
  }
});

test('inventory route requires permission and has no mutation endpoints', async (t) => {
  t.mock.method(Product, 'find', () => ({ select: () => ({ sort: () => ({ lean: async () => [{ name: 'Plate', quantity: 12 }] }) }) }));
  const denied = response();
  await handler(router, '/inventory')({ auth: { ...user, permissions: {} } }, denied);
  assert.equal(denied.code, 403);
  const allowed = response();
  await handler(router, '/inventory')({ auth: user }, allowed);
  assert.deepEqual(allowed.body.items, [{ name: 'Plate', quantity: 12 }]);
  assert.ok(router.stack.filter((layer) => layer.route?.path === '/inventory').every((layer) => Object.keys(layer.route.methods).every((method) => method === 'get')));
});

test('admin can save Executive Chef as Event Staff and revoke inventory viewing', async (t) => {
  const saved = new User({ ...user, password: 'test-hash', jobTitle: 'executive chef' });
  saved.save = async () => { await saved.validate(); };
  t.mock.method(User, 'findById', () => ({ select: async () => saved }));
  for (const inventoryRead of [true, false]) {
    const res = response();
    await handler(userRouter, '/:id', 'patch')({ auth: { role: 'admin' }, params: { id: userId }, body: { role: 'event staff', jobTitle: 'executive chef', nowstaName: 'Maye La Monica', permissions: { inventoryRead }, seeProposals: false, seeBarFinancials: false } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.jobTitle, 'executive chef');
    assert.equal(res.body.role, 'event staff');
    assert.equal(res.body.permissions.inventoryRead, inventoryRead);
  }
});

test('authorization uses current persisted role, Nowsta identity and inventory permission on every request', async (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'event-staff-test-secret';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const token = jwt.sign({ sub: userId, role: 'admin', nowstaName: 'Stale name', permissions: { inventoryRead: true } }, process.env.JWT_SECRET);
  let persisted = { ...user, permissions: { inventoryRead: false }, isActive: true };
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => persisted }) }));
  for (const originalUrl of ['/api/events', '/api/staff-portal/inventory']) {
    const res = response();
    await requireAuth({ method: 'GET', originalUrl, headers: { authorization: `Bearer ${token}` } }, res, () => assert.fail('Stale privilege must not pass'));
    assert.equal(res.code, 403);
  }
  const req = { method: 'GET', originalUrl: '/api/staff-portal/events', headers: { authorization: `Bearer ${token}` } };
  let passed = false;
  await requireAuth(req, response(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.auth.nowstaName, 'Maye La Monica');
  persisted = { ...persisted, permissions: { inventoryRead: true } };
  await requireAuth({ ...req, originalUrl: '/api/staff-portal/inventory' }, response(), () => {});
});
