import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import Staff from '../models/Staff.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import workspace from '../routes/uniformWorkspace.js';
import packing from '../routes/uniformPacking.js';
import { buildNowstaScheduleRows } from '../utils/nowstaApi.js';
import { eventUniformRequirements } from '../utils/uniformRequirements.js';
import { buildUniformRoster, uniformPackerRequestAllowed } from '../utils/uniformPacking.js';
import { renderUserInviteEmail } from '../utils/userInvitations.js';

const chain = (data) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => data });
const handler = (router, path) => router.stack.find((layer) => layer.route?.path === path).route.stack[0].handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const eventId = '507f1f77bcf86cd799439011';

test('Nowsta sizes survive schedule normalization and fill only missing saved staff sizes', () => {
  const [entry] = buildNowstaScheduleRows({ events: [{ id: 42, name: 'Reception', occurs_at: '2026-10-02T20:00:00Z', uniform: 'Black suit' }],
    shifts: [{ id: 1, event_id: 42, position_name: 'Captain', uniform: { name: 'Black Nehru' }, event_workers: [{ company_user_id: 1, status: 'confirmed' }] }],
    companyUsers: [{ id: 1, first_name: 'Alex', last_name: 'Smith', clothing_sizes: { jacket_size: '42L', shirt_size: 'L', pants_size: '34x32', shoe_size: 10.5 } }] });
  assert.equal(entry.uniform, 'Black suit');
  assert.equal(entry.shifts[0].uniform, 'Black Nehru');
  const [person] = buildUniformRoster(entry, [{ nowstaCompanyUserId: '1', shirtSize: 'XL' }]);
  assert.equal(person.shirtSize, 'XL');
  assert.equal(person.jacketSize, '42L');
  assert.equal(person.pantsSize, '34x32');
  assert.equal(person.shoeSize, '10.5');
  assert.deepEqual(person.missingSizes, []);
});

test('uniform requirements fall back by position and flag contradictory instructions without guessing quantities', () => {
  const event = { catereaseOperations: { staffRequest: [
    { position: 'Waiter', uniform: 'Black Nehru' }, { position: 'Captain', uniform: 'Black suit' }, { position: 'Lead Chef', uniform: 'Chef whites' },
  ] } };
  const rows = eventUniformRequirements({ shifts: [{ position: 'Waiter' }, { position: 'Captain', uniform: 'White jacket' }] }, event);
  assert.equal(rows[0].source, 'Staff Request');
  assert.equal(rows[0].uniform, 'Black Nehru');
  assert.equal(rows[0].conflict, false);
  assert.equal(rows[1].source, 'Nowsta');
  assert.equal(rows[1].uniform, 'White jacket');
  assert.equal(rows[1].conflict, true);
  assert.equal(rows.length, 2);
});

test('uniform role can read shared events and reports, but cannot write reports or access boards', () => {
  const auth = { role: 'uniform packer', userId: 'self' };
  const allowed = (method, path) => uniformPackerRequestAllowed(auth, { method, originalUrl: path });
  assert.equal(allowed('GET', '/api/uniform-packing/workspace/events'), true);
  assert.equal(allowed('GET', `/api/uniform-packing/workspace/events/${eventId}/reports`), true);
  assert.equal(allowed('GET', '/api/nowsta-schedule'), true);
  assert.equal(allowed('PUT', '/api/nowsta-schedule/preferences'), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(allowed(method, `/api/uniform-packing/workspace/events/${eventId}/reports`), false);
  assert.equal(allowed('GET', '/api/uniform-packing/events/42/boards'), false);
  assert.equal(allowed('GET', '/api/uniform-packing/events/42/boards/page/thumbnail'), false);
  assert.equal(allowed('POST', '/api/event-reports/123/email'), false);
  assert.equal(allowed('POST', '/api/nowsta-schedule'), false);
});

test('uniform entered only against Captain applies to unlabelled waiters and bartenders', () => {
  const rows = eventUniformRequirements({ shifts: [{ position: 'Captain' }, { position: 'Waiter' }, { position: 'Bartender' }] },
    { catereaseOperations: { staffRequest: [{ position: 'Captain', uniform: 'Black Mandarin' }] } });
  assert.deepEqual(rows.map((row) => row.uniform), ['Black Mandarin', 'Black Mandarin', 'Black Mandarin']);
  assert.equal(rows[1].inherited, true);
});

test('captain default requires a packed shirt and tie, while keeping explicit event instructions', () => {
  const entry = { uniform: 'Black Mandarin', shifts: [{ position: 'Captain' }, { position: 'Waiter' }] };
  const rows = eventUniformRequirements(entry);
  assert.match(rows[0].uniform, /White Button Down Shirt \+ Black Tie/);
  assert.equal(rows[0].selfProvided, false);
  assert.equal(rows[1].uniform, 'Black Mandarin');
  const explicit = eventUniformRequirements(entry, { catereaseOperations: { staffRequest: [{ position: 'Captain', uniform: 'White Nehru' }] } });
  assert.equal(explicit[0].uniform, 'White Nehru');
  assert.equal(explicit[0].selfProvided, false);
});

test('multiple distinct instructions are not guessed for unlabelled staff and explicit exceptions survive', () => {
  const rows = eventUniformRequirements({ uniform: 'Black Mandarin', shifts: [{ position: 'Waiter' }, { position: 'Lead Chef', uniform: 'Chef whites' }] });
  assert.equal(rows[0].uniform, 'Black Mandarin');
  assert.equal(rows.length, 1);
  const ambiguous = eventUniformRequirements({ shifts: [{ position: 'Waiter' }, { position: 'Captain', uniform: 'White Nehru' }, { position: 'Bartender', uniform: 'Black shirt' }] });
  assert.equal(ambiguous[0].uniform, '');
});

test('readonly report list selects only submitted reports for this event and does not send or create requests', async (t) => {
  t.mock.method(EventReport, 'find', (query) => { assert.deepEqual(query, { eventId, status: 'submitted' }); return chain([{ _id: 'report', eventId, status: 'submitted' }]); });
  t.mock.method(EventReportFile, 'find', (query) => { assert.deepEqual(query, { eventId }); return chain([]); });
  t.mock.method(EventReport, 'create', () => assert.fail('Viewing reports must not create requests'));
  t.mock.method(EventReport, 'updateOne', () => assert.fail('Viewing reports must not change delivery state'));
  const res = response();
  await handler(workspace, '/events/:eventId/reports')({ uniformEvent: { _id: eventId } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.items[0].canCancelRequest, false);
  assert.deepEqual(res.body.files, []);
});

test('report download refuses a report belonging to another event or a draft', async (t) => {
  const reportId = '507f1f77bcf86cd799439012';
  t.mock.method(EventReport, 'findOne', (query) => { assert.deepEqual(query, { _id: reportId, eventId, status: 'submitted' }); return chain(null); });
  const res = response();
  await handler(workspace, '/events/:eventId/reports/:reportId/pdf')({ params: { reportId }, uniformEvent: { _id: eventId } }, res);
  assert.equal(res.code, 404);
});

test('opening a shared event keeps its existing Nowsta packout and returns automatic Staff Request uniform', async (t) => {
  t.mock.method(Event, 'findOne', () => chain({ _id: eventId, meta: { nowsta: { apiEventId: '42' } } }));
  t.mock.method(Event, 'find', () => chain([{ _id: eventId, catereaseOperations: { staffRequest: [{ position: 'Waiter', uniform: 'Black Nehru' }] } }]));
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain({ nowstaEventId: '42', shifts: [{ position: 'Waiter', workers: [{ companyUserId: '1', name: 'Alex', status: 'confirmed' }] }] }));
  t.mock.method(UniformPackout, 'findOne', (query) => { assert.deepEqual(query, { nowstaEventId: '42' }); return chain({ revision: 5, lines: [{ quantity: 7 }] }); });
  t.mock.method(Staff, 'find', () => chain([])); t.mock.method(UniformItem, 'find', () => chain([]));
  const res = response();
  await handler(packing, '/events/:id')({ params: { id: `event:${eventId}` } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.event.linkedEventId, eventId);
  assert.equal(res.body.packout.revision, 5);
  assert.equal(res.body.packout.lines[0].quantity, 7);
  assert.equal(res.body.roster[0].uniform, 'Black Nehru');
});

test('uniform invitation guides packers through Events and on-screen sizes without board or CSV instructions', () => {
  const { text } = renderUserInviteEmail({ role: 'uniform packer', name: 'Alex', inviteUrl: 'https://example.com/invite' });
  assert.match(text, /open Events/);
  assert.match(text, /Staff & Uniform/);
  assert.match(text, /Nowsta or Staff Request/);
  assert.doesNotMatch(text, /CSV|Download the staffing|uniform boards/);
});
