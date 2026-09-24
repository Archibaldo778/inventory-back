import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNowstaImportRows,
  buildNowstaDepartmentRows,
  buildNowstaScheduleRows,
  classifyNowstaSourceEvents,
  createNowstaClient,
  isNowstaOperationalEventTitle,
  nowstaEventSalesperson,
  resolveNowstaSyncRange,
} from '../utils/nowstaApi.js';
import { uniqueNowstaTitleDateMatch } from '../routes/events.js';

test('Nowsta sync may attach staffing to one unique same-title same-date event', () => {
  const event = { _id: 'existing-event' };
  assert.equal(uniqueNowstaTitleDateMatch([event]), event);
  assert.equal(uniqueNowstaTitleDateMatch([]), null);
  assert.equal(uniqueNowstaTitleDateMatch([event, { _id: 'duplicate' }]), null);
});

test('Nowsta API rows preserve stable IDs and include assigned workers', () => {
  const rows = buildNowstaImportRows({
    events: [{
      id: 91,
      company_id: 7,
      name: 'Dinner at Water Mill',
      occurs_at: '2026-09-05T22:00:00Z',
      ends_at: '2026-09-06T03:00:00Z',
      time_zone: 'America/New_York',
      client_name: 'Milken Institute',
      venue_name: 'Water Mill',
      address1: '1 Main St',
      city: 'Water Mill',
      state: 'NY',
      primary_external_id: 'E22554',
      external_id: 'S61715',
      number_of_guests: 150,
      salesperson_id: 15,
    }],
    shifts: [{
      event_id: 91,
      position_name: 'Bartender',
      starts_at: '2026-09-05T21:00:00Z',
      ends_at: '2026-09-06T03:00:00Z',
      time_zone: 'America/New_York',
      quantity: 2,
      open_count: 1,
      event_workers: [{ company_user_id: 12, status: 'confirmed' }],
    }],
    companyUsers: [
      { id: 12, first_name: 'Aidan', last_name: 'Collis', phone_number: '+1 917 555 0100' },
      { id: 15, first_name: 'Oliver', last_name: 'Cheng' },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'E22554 - S61715');
  assert.equal(rows[0].date, '2026-09-05');
  assert.equal(rows[0].meta.nowsta.apiEventId, '91');
  assert.equal(rows[0].meta.nowsta.shifts[0].workers[0].name, 'Aidan Collis');
  assert.equal(rows[0].meta.nowsta.shifts[0].workers[0].phone, '+1 917 555 0100');
  assert.equal(rows[0].meta.nowsta.shifts[0].unfilled, 1);
  assert.equal(rows[0].managerId, 'Oliver Cheng');
  assert.equal(rows[0].meta.salesRep, 'Oliver Cheng');
});

test('Nowsta salesperson accepts names, nested people, and company user ids', () => {
  const people = new Map([['15', { id: 15, first_name: 'Oliver', last_name: 'Cheng' }]]);
  assert.equal(nowstaEventSalesperson({ salesperson_name: 'Oliver Cheng' }, people), 'Oliver Cheng');
  assert.equal(nowstaEventSalesperson({ salesperson: { first_name: 'George', last_name: 'Smith' } }, people), 'George Smith');
  assert.equal(nowstaEventSalesperson({ salesperson_id: 15 }, people), 'Oliver Cheng');
});

test('Nowsta rows resolve addresses from a referenced venue', () => {
  const [row] = buildNowstaScheduleRows({
    events: [{
      id: 92,
      name: 'Venue-backed event',
      occurs_at: '2026-09-24T21:30:00Z',
      ends_at: '2026-09-25T04:00:00Z',
      time_zone: 'America/New_York',
      venue_id: 44,
    }],
    venues: [{ id: 44, name: 'FoundRae', address1: '176 Duane St', address2: '2', city: 'New York', state: 'NY', zip: '10013' }],
  });
  assert.equal(row.venue, 'FoundRae');
  assert.equal(row.address, '176 Duane St, 2, New York, NY, 10013');
});

test('Nowsta client sends the access key only as a bearer header', async () => {
  let captured;
  const client = createNowstaClient({
    apiKey: 'secret-key',
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ objects: [], currentPage: 1, totalPages: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await client.listAll('/v2/events', { page: 1 });
  assert.equal(captured.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(captured.url.includes('secret-key'), false);
});

test('Nowsta default sync range is bounded and valid', () => {
  const range = resolveNowstaSyncRange({ now: new Date('2026-09-04T12:00:00Z') });
  assert.ok(range.from < range.to);
  assert.match(range.from, /^2026-/);
  assert.match(range.to, /^2027-/);
});

test('Nowsta department catalog includes departments without events', () => {
  assert.deepEqual(buildNowstaDepartmentRows([
    { id: 10, name: 'Event Drivers' },
    { id: 20, name: 'Ops' },
    { id: 20, name: 'Ops' },
    { id: 30, display_name: 'Hand Deliveries' },
  ]), [
    { nowstaDepartmentId: '10', name: 'Event Drivers', archived: false },
    { nowstaDepartmentId: '20', name: 'Ops', archived: false },
    { nowstaDepartmentId: '30', name: 'Hand Deliveries', archived: false },
  ]);
});

test('Nowsta operational schedule names are matched narrowly', () => {
  assert.equal(isNowstaOperationalEventTitle('Deliveries'), true);
  assert.equal(isNowstaOperationalEventTitle('OPS'), true);
  assert.equal(isNowstaOperationalEventTitle('Office Help - PM'), true);
  assert.equal(isNowstaOperationalEventTitle('Hermes Hospitality'), true);
  assert.equal(isNowstaOperationalEventTitle('Hermes 706 Madison Hospitality Team'), true);
  assert.equal(isNowstaOperationalEventTitle('Hermes Williamsburg Opening Dinner'), false);
  assert.equal(isNowstaOperationalEventTitle('Sono Bello - Delivery Day'), false);
});

test('Nowsta classifier excludes service, archived, missing-ID, and recurring schedules', () => {
  const event = (id, name, date, externalId, extra = {}) => ({
    id,
    name,
    occurs_at: `${date}T16:00:00Z`,
    time_zone: 'UTC',
    external_id: externalId,
    ...extra,
  });
  const result = classifyNowstaSourceEvents([
    event(1, 'Client Dinner', '2026-09-05', 'E1'),
    event(2, 'Deliveries', '2026-09-05', 'E2'),
    event(3, 'Hermes Williamsburg Opening Dinner', '2026-09-05', 'E3'),
    event(4, 'Hermes 706 Madison Hospitality Team', '2026-09-05', 'E4'),
    event(5, 'Weekly Schedule', '2026-09-05', 'E5'),
    event(6, 'Weekly Schedule', '2026-09-06', 'E5'),
    event(7, 'No identifier', '2026-09-05', ''),
    event(8, 'Archived Dinner', '2026-09-05', 'E8', { archived_at: '2026-09-01' }),
  ]);

  assert.deepEqual(result.included.map((item) => item.id), [1, 3]);
  assert.deepEqual(
    Object.fromEntries(result.excluded.map((item) => [item.apiEventId, item.reason])),
    {
      2: 'operational_schedule',
      4: 'operational_schedule',
      5: 'recurring_schedule',
      6: 'recurring_schedule',
      7: 'missing_external_id',
      8: 'archived',
    }
  );
});

test('Nowsta company schedule keeps operational events and booked drivers', () => {
  const rows = buildNowstaScheduleRows({
    events: [{
      id: 22,
      company_id: 7,
      name: 'Deliveries',
      occurs_at: '2026-09-24T12:00:00Z',
      ends_at: '2026-09-24T20:00:00Z',
      time_zone: 'America/New_York',
      department_id: 13,
    }],
    shifts: [{
      id: 501,
      event_id: 22,
      position_name: 'Driver',
      starts_at: '2026-09-24T12:00:00Z',
      ends_at: '2026-09-24T20:00:00Z',
      time_zone: 'America/New_York',
      quantity: 1,
      event_workers: [{ company_user_id: 91, status: 'confirmed' }],
    }],
    companyUsers: [{
      id: 91,
      first_name: 'Test',
      last_name: 'Driver',
      email: 'driver@example.com',
      phone_number: '2125550100',
    }],
    departments: [{ id: 13, name: 'Event Drivers' }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Deliveries');
  assert.equal(rows[0].departmentName, 'Event Drivers');
  assert.equal(rows[0].defaultVisible, false);
  assert.equal(rows[0].staffingProgress, 'fully_staffed');
  assert.equal(rows[0].shifts[0].workers[0].name, 'Test Driver');
  assert.equal(rows[0].shifts[0].workers[0].email, 'driver@example.com');
});

test('Nowsta company schedule can keep current customer departments visible by default', () => {
  const rows = buildNowstaScheduleRows({
    events: [{
      id: 23,
      name: 'Client Dinner',
      occurs_at: '2026-09-24T22:00:00Z',
      time_zone: 'America/New_York',
      department: { name: 'Staffing and Service' },
    }],
    defaultVisibleIds: new Set(['23']),
  });

  assert.equal(rows[0].defaultVisible, true);
  assert.equal(rows[0].departmentName, 'Staffing and Service');
  assert.equal(rows[0].staffingProgress, 'empty');
});
