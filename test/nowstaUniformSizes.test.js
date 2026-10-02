import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowstaSizeReader, fillMissingNowstaSizes } from '../utils/nowstaUniformSizes.js';
import { nowstaClothingSizes, eventUniformRequirements } from '../utils/uniformRequirements.js';
import { buildNowstaImportRows, buildNowstaScheduleRows, fetchNowstaImportRows } from '../utils/nowstaApi.js';

const assignments = [
  { company_user_id: 12, clothing_size_name: 'Jacket', value: '42L' },
  { company_user_id: 12, clothing_size_name: 'Shirt', value: 'L' },
  { company_user_id: 12, clothing_size_name: 'Pants', value: '34x32' },
  { company_user_id: 12, clothing_size_name: 'Shoes', value: '10.5' },
  { company_user_id: 12, clothing_size_name: 'Height', value: '6 feet' },
];
const person = { companyUserId: '12', name: 'Example Worker', shirtSize: 'XL', missingSizes: ['jacketSize', 'pantsSize', 'shoeSize'] };
const completeSizes = { jacketSize: '42L', shirtSize: 'L', pantsSize: '34x32', shoeSize: '10.5', height: '6 feet' };

test('real Nowsta clothing assignment fields map to the roster and ignore archived or unrelated attributes', () => {
  const result = nowstaClothingSizes({ clothing_sizes: [
    { clothing_size_name: 'Jacket', value: 'archived', archived_at: '2026-01-01' },
    { clothing_size_name: 'Other information', value: 'not a size' }, ...assignments,
  ] });
  assert.deepEqual(result, completeSizes);
});

test('size lookup uses the employee clothing endpoint, scopes responses, shares concurrent requests and expires its cache', async () => {
  let calls = 0; let time = 0;
  const read = createNowstaSizeReader({ now: () => time, ttlMs: 10, clientFactory: () => ({ listAll: async (path) => {
    calls += 1; assert.equal(path, '/v2/company_users/12/clothing_sizes');
    return [{ company_user_id: 99, clothing_size_name: 'Shirt', value: 'Wrong employee' }, ...assignments];
  } }) });
  const results = await Promise.all([read('12'), read('12')]);
  assert.equal(calls, 1); assert.deepEqual(results, [completeSizes, completeSizes]);
  await read('12'); assert.equal(calls, 1);
  time = 11; await read('12'); assert.equal(calls, 2);
});

test('failed reads are retried on the next load rather than caching missing sizes', async () => {
  let calls = 0;
  const read = createNowstaSizeReader({ clientFactory: () => ({ listAll: async () => {
    if (++calls === 1) throw new Error('Temporary outage'); return assignments;
  } }) });
  await assert.rejects(read('12'), /Temporary outage/);
  assert.deepEqual(await read('12'), completeSizes); assert.equal(calls, 2);
});

test('Nowsta fills only missing sizes, preserving saved sizes and requesting only employees who need a lookup', async () => {
  const requests = [];
  const input = [person, { ...person, companyUserId: '13', ...completeSizes }, { ...person, companyUserId: '' }];
  const result = await fillMissingNowstaSizes(input, { read: async (id) => { requests.push(id); return completeSizes; } });
  assert.deepEqual(requests, ['12']);
  assert.equal(result.roster[0].shirtSize, 'XL');
  assert.equal(result.roster[0].jacketSize, '42L');
  assert.deepEqual(result.roster[0].missingSizes, []);
  assert.equal(result.sizeLookupWarning, '');
  assert.equal(input[0].jacketSize, undefined, 'The saved roster is not mutated');
});

test('API failures preserve saved sizes and show a reload warning without blocking packing', async () => {
  const result = await fillMissingNowstaSizes([person], { read: async () => { throw Object.assign(new Error('Unavailable'), { statusCode: 503 }); } });
  assert.equal(result.roster[0].shirtSize, 'XL');
  assert.equal(result.roster[0].jacketSize, undefined);
  assert.match(result.sizeLookupWarning, /1 staff.*Reload/);
});

test('lookups cap concurrency and stop queuing calls after rate limits or the response budget', async () => {
  const roster = Array.from({ length: 20 }, (_, i) => ({ ...person, companyUserId: String(i + 1) }));
  let active = 0; let peak = 0; let calls = 0;
  await fillMissingNowstaSizes(roster, { read: async () => {
    calls += 1; active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1;
    throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
  } });
  assert.equal(calls, 4); assert.equal(peak, 4);
  let tick = 0;
  const result = await fillMissingNowstaSizes(roster, { now: () => tick++, budgetMs: 0, read: () => assert.fail('Expired lookups must not start') });
  assert.match(result.sizeLookupWarning, /20 staff/);
});

const data = {
  events: [{ id: 42, name: 'Reception', external_id: 'E42', occurs_at: '2026-10-02T20:00:00Z', uniform_id: 1 }],
  shifts: [{ id: 2, event_id: 42, position_name: 'Captain', uniform_id: 2, event_workers: [] }],
  uniforms: [{ id: 1, name: 'Black Nehru', description: 'Black pants' }, { id: 2, name: 'Suit', description: 'White shirt' }],
};

test('event and shift uniform IDs resolve through the Nowsta catalog, keeping shift-specific requirements', () => {
  const [event] = buildNowstaImportRows(data);
  const [schedule] = buildNowstaScheduleRows(data);
  assert.equal(event.meta.nowsta.uniform, 'Black Nehru — Black pants');
  assert.equal(schedule.uniform, event.meta.nowsta.uniform);
  assert.equal(schedule.shifts[0].uniform, 'Suit — White shirt');
  assert.equal(event.meta.nowsta.shifts[0].uniform, schedule.shifts[0].uniform);
  assert.equal(buildNowstaScheduleRows({ ...data, uniforms: [] })[0].uniform, '');
});

test('Nowsta catalog descriptions do not falsely conflict with a matching Staff Request uniform name', () => {
  const [entry] = buildNowstaScheduleRows(data);
  const request = (uniform) => ({ catereaseOperations: { staffRequest: [{ position: 'Captain', uniform }] } });
  assert.equal(eventUniformRequirements(entry, request('Suit'))[0].conflict, false);
  assert.equal(eventUniformRequirements(entry, request('Black Nehru'))[0].conflict, true);
});

test('normal Nowsta sync fetches uniform definitions and aborts on a partial catalog instead of erasing requirements', async () => {
  let failCatalog = false;
  const paths = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname.split('/').pop(); paths.push(path);
    if (path === 'uniforms' && failCatalog) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ objects: data[path] || [], totalPages: 1 }), { headers: { 'content-type': 'application/json' } });
  };
  const options = { from: '2026-10-01', to: '2026-10-03', apiKey: 'test-only', fetchImpl };
  const result = await fetchNowstaImportRows(options);
  assert.ok(paths.includes('uniforms'));
  assert.equal(result.scheduleEvents[0].uniform, 'Black Nehru — Black pants');
  failCatalog = true;
  await assert.rejects(fetchNowstaImportRows(options), /503/);
});
