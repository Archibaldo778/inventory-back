import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNowstaImportRows,
  createNowstaClient,
  resolveNowstaSyncRange,
} from '../utils/nowstaApi.js';

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
    companyUsers: [{ id: 12, first_name: 'Aidan', last_name: 'Collis' }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, 'E22554 - S61715');
  assert.equal(rows[0].date, '2026-09-05');
  assert.equal(rows[0].meta.nowsta.apiEventId, '91');
  assert.equal(rows[0].meta.nowsta.shifts[0].workers[0].name, 'Aidan Collis');
  assert.equal(rows[0].meta.nowsta.shifts[0].unfilled, 1);
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
