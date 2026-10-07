import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import router, { syncBarEventClientPricing } from '../routes/catereaseIntegration.js';

const id = '68c70548aea053de74d25b22';
const event = () => ({ _id: id, id, linkedEventId: '68c7047faea053de74d25b15', items: [], clientCharge: 0, revision: 0, audit: [], save: async () => {} });
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const handler = router.stack.find((layer) => layer.route?.path === '/financials/sync-report').route.stack.at(-1).handle;

test('pricing sync saves the shared charge and returns success after writing its audit', async (t) => {
  const original = Event.findById;
  t.after(() => { Event.findById = original; });
  Event.findById = () => ({ select() { return this; }, lean: async () => ({ externalId: 'E100', title: 'Dinner', date: '2026-10-08' }) });
  const record = event();
  let saves = 0;
  record.save = async () => { saves += 1; };
  const response = await syncBarEventClientPricing(record, { username: 'Sam Rivers' }, {
    resolveEventId: async () => 'E100', loadBundle: async () => ({ includes: { lineItems: { _status: 'ok', data: [{ id: 'b', name: 'Beverage', category: 'Beverage', lineTotal: 2400 }] } } }),
  });
  assert.equal(record.clientCharge, 2400);
  assert.equal(saves, 1);
  assert.equal(response.summary.appliedClientCharge, 2400);
  assert.equal(record.audit[0].username, 'Sam Rivers');
  const cached = await syncBarEventClientPricing(record, {}, { loadBundle: async () => { throw new Error('Must use shared cooldown'); } });
  assert.equal(cached.cached, true);
});

test('partial upstream billing never overwrites saved amounts or counts as a successful refresh', async (t) => {
  const original = Event.findById;
  t.after(() => { Event.findById = original; });
  Event.findById = () => ({ select() { return this; }, lean: async () => ({ externalId: 'E100' }) });
  const record = { ...event(), clientCharge: 500 };
  await assert.rejects(syncBarEventClientPricing(record, {}, { resolveEventId: async () => 'E100', loadBundle: async () => ({ includes: { lineItems: { _status: 'error' } } }) }), /incomplete/);
  assert.equal(record.clientCharge, 500);
});

test('a complete response with no billed items returns normally', async (t) => {
  const original = Event.findById;
  t.after(() => { Event.findById = original; });
  Event.findById = () => ({ select() { return this; }, lean: async () => ({ externalId: 'E100' }) });
  const result = await syncBarEventClientPricing(event(), {}, { resolveEventId: async () => 'E100', loadBundle: async () => ({ includes: { lineItems: { _status: 'ok', data: [] } } }) });
  assert.equal(result.ok, true);
});

test('report refresh enforces financial access and a bounded request size', async () => {
  let response = res();
  await handler({ auth: { role: 'captain' }, body: { eventIds: [id] } }, response);
  assert.equal(response.statusCode, 403);
  response = res();
  await handler({ auth: { role: 'super admin' }, body: { eventIds: ['invalid'] } }, response);
  assert.equal(response.statusCode, 400);
});

test('batch refresh preserves manual charges instead of silently replacing them', async (t) => {
  const original = BarEvent.find;
  t.after(() => { BarEvent.find = original; });
  BarEvent.find = async () => [{ ...event(), clientCharge: 800, clientChargeDetails: { source: 'manual' } }];
  const response = res();
  await handler({ auth: { role: 'super admin' }, body: { eventIds: [id] } }, response);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.results[0].skipped, true);
});

test('a complete empty billing response clears an old Caterease charge instead of exporting stale revenue', async (t) => {
  const original = Event.findById;
  t.after(() => { Event.findById = original; });
  Event.findById = () => ({ select() { return this; }, lean: async () => ({ externalId: 'E100' }) });
  const record = { ...event(), clientCharge: 500, clientChargeDetails: { source: 'caterease' }, catereaseClientChargeSnapshot: { syncedAt: new Date('2020-01-01'), beverageTotal: 500 } };
  const result = await syncBarEventClientPricing(record, {}, { resolveEventId: async () => 'E100', loadBundle: async () => ({ includes: { lineItems: { _status: 'ok', data: [] } } }) });
  assert.equal(record.clientCharge, 0);
  assert.equal(record.catereaseClientChargeSnapshot.beverageTotal, 0);
  assert.equal(result.summary.appliedClientCharge, 0);
});
