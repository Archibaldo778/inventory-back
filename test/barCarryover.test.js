import test from 'node:test';
import assert from 'node:assert/strict';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import router from '../routes/bar.js';
import guestRouter, { publicEvent } from '../routes/publicBarReturns.js';
import { nextBarCarryoverEvent, buildBarCarryoverPlan, carryBarReturnsForward } from '../utils/barCarryover.js';
import { mergeManualItemsWithPackout, mergePackoutDocumentItems, preservePackoutOperationalState } from '../utils/barManualItems.js';

const sourceId = '6ab537c6486fd0363d1e8ee7';
const targetId = '6ab537c6486fd0363d1e8ee8';
const itemId = '6abac73c9f954f3a69a5e267';
const source = () => ({ _id: sourceId, name: 'Prada Saks 5th Ave. Beverage Service - Day 1', eventDate: '2026-10-01', client: 'PRADA USA Corp.', status: 'submitted', items: [{ _id: itemId, beverageItemId: '6aad4c7367573945a73e51a5', name: 'LA Caravelle Champagne 1 Case', scope: 'alcohol', included: true, sentQty: 12, deliveredQty: null, returnedFullQty: 0, returnedOpenQty: 11, returnConfirmed: true }] });
const target = () => ({ _id: targetId, name: 'Prada Saks 5th Ave. Beverage Service - Day 2', eventDate: '2026-10-02', client: 'PRADA USA Corp.', status: 'draft', revision: 17, __v: 0, items: [] });
const query = (value) => ({ select() { return this; }, lean: async () => value });
const handler = (routes, path, method) => routes.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('Prada Day 1 remaining 11 bottles become Day 2 received stock with fresh return counts', async () => {
  const first = source();
  const next = target();
  const original = structuredClone(first);
  const plan = buildBarCarryoverPlan(first, next);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.items.length, 1);
  const item = plan.items[0];
  assert.equal(item.sentQty, 11);
  assert.equal(item.deliveredQty, 11);
  assert.equal(item.returnedFullQty + item.returnedOpenQty, 0);
  assert.equal(item.returnConfirmed, false);
  assert.equal(item.carryover.sourceItemId, itemId);
  assert.equal(item.entrySource, 'carryover');
  assert.deepEqual(first, original);
  assert.equal(next.items.length, 0);
  const doc = new BarEvent({ ...next, items: plan.items });
  await doc.validate();
  const visible = publicEvent(doc);
  assert.equal(visible.hasPackout, true);
  assert.equal(visible.items[0].deliveredQty, 11);
  assert.equal(visible.items[0].returnRequired, true);
  assert.equal(visible.items[0].carryover.sourceEventName, first.name);
});

test('retry never doubles received stock or overwrites next-day captain edits; source corrections require review', () => {
  const first = source();
  const next = target();
  next.items = buildBarCarryoverPlan(first, next).items;
  next.items[0].deliveredQty = 10;
  next.items[0].returnedOpenQty = 4;
  const original = JSON.stringify(next);
  assert.equal(buildBarCarryoverPlan(first, next).status, 'unchanged');
  assert.equal(JSON.stringify(next), original);
  first.items[0].returnedOpenQty = 9;
  assert.throws(() => buildBarCarryoverPlan(first, next), /source count changed/);
  assert.equal(JSON.stringify(next), original);
});

test('only matching next numbered day is eligible, excluding other clients, distant dates and ambiguous matches', () => {
  const next = target();
  const unrelated = { ...next, name: 'Prada Madison - Day 2' };
  const otherClient = { ...next, client: 'Someone else' };
  const dayThree = { ...next, name: next.name.replace('Day 2', 'Day 3') };
  assert.equal(nextBarCarryoverEvent(source(), [unrelated, otherClient, dayThree, { ...next, eventDate: '2026-11-02' }]), null);
  assert.equal(nextBarCarryoverEvent(source(), [unrelated, next]), next);
  assert.throws(() => nextBarCarryoverEvent(source(), [next, { ...next, _id: 'another' }]), /Several events/);
  assert.equal(nextBarCarryoverEvent({ ...source(), packout: { seriesRole: 'final' } }, [next]), null);
});

test('only confirmed, included, returnable stock transfers, including fractional open bottles', () => {
  const first = source();
  first.items[0].returnedFullQty = 2;
  first.items[0].returnedOpenQty = 0.75;
  first.items.push({ name: 'Napkins', scope: 'non_bar', returnConfirmed: false });
  first.items.push({ ...first.items[0], included: false, returnConfirmed: false });
  assert.equal(buildBarCarryoverPlan(first, target()).items[0].deliveredQty, 2.75);
  first.items[0].returnConfirmed = false;
  assert.throws(() => buildBarCarryoverPlan(first, target()), /Confirm all/);
  first.items[0].returnConfirmed = true;
  assert.throws(() => buildBarCarryoverPlan(first, { ...target(), status: 'submitted' }), /already has a submitted/);
  assert.equal(buildBarCarryoverPlan({ ...first, status: 'ready' }, target()).status, 'not_submitted');
  first.items[0].returnedFullQty = first.items[0].returnedOpenQty = 0;
  assert.equal(buildBarCarryoverPlan(first, target()).status, 'empty');
});

test('PO and KM reimports retain carried stock separately from a new shipment of the same beverage', () => {
  const carry = buildBarCarryoverPlan(source(), target()).items[0];
  carry.returnedOpenQty = 3;
  const imported = [{ name: carry.name, beverageItemId: carry.beverageItemId, scope: 'alcohol', sentQty: 5 }];
  for (const merge of [mergeManualItemsWithPackout, (existing, incoming) => mergePackoutDocumentItems(existing, incoming, ['po'])]) {
    let existing = [carry];
    for (let i = 0; i < 3; i++) {
      const rows = preservePackoutOperationalState(existing, merge(existing, imported));
      assert.equal(rows.length, 2);
      const transferred = rows.find((item) => item.carryover?.sourceEventId);
      const shipment = rows.find((item) => !item.carryover?.sourceEventId);
      assert.equal(String(transferred._id), String(carry._id));
      assert.equal(transferred.deliveredQty, 11);
      assert.equal(transferred.returnedOpenQty, 3);
      assert.equal(shipment.sentQty, 5);
      assert.equal(shipment.deliveredQty ?? null, null);
      assert.equal(shipment.returnedOpenQty || 0, 0);
      existing = rows;
    }
    const km = mergePackoutDocumentItems(existing, [], ['kitchen_menu']);
    assert.equal(km.find((item) => item.carryover?.sourceEventId).deliveredQty, 11);
  }
});

function mockStorage(t, first, next) {
  let writes = 0;
  t.mock.method(BarEvent, 'find', () => query([next]));
  t.mock.method(BarEvent, 'findById', (value) => String(value) === sourceId ? Promise.resolve(first) : query(next));
  t.mock.method(BarEvent, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(first.status, 'submitted');
    assert.equal(String(filter._id), targetId);
    assert.equal(filter.revision, next.revision);
    assert.equal(filter.__v, next.__v);
    assert.deepEqual(filter['items.carryover.sourceEventId'], { $ne: sourceId });
    assert.deepEqual(filter.status, { $nin: ['submitted', 'reviewed', 'closed'] });
    next.items.push(...update.$push.items.$each);
    next.status = update.$set?.status || next.status;
    next.revision += update.$inc.revision;
    next.__v += update.$inc.__v;
    writes++;
    return next;
  });
  return () => writes;
}

test('atomic transfer appends once with revision guards and retries safely after another request wins', async (t) => {
  const first = source();
  const next = target();
  const writes = mockStorage(t, first, next);
  const originalWrite = BarEvent.findOneAndUpdate;
  t.mock.method(BarEvent, 'findOneAndUpdate', async (...args) => { await originalWrite(...args); return null; });
  assert.equal((await carryBarReturnsForward(first)).status, 'unchanged');
  assert.equal((await carryBarReturnsForward(first)).status, 'unchanged');
  assert.equal(writes(), 1);
  assert.equal(next.items[0].deliveredQty, 11);
});

test('cancelled linked events are never transfer targets', async (t) => {
  const first = source();
  const next = { ...target(), linkedEventId: targetId };
  const writes = mockStorage(t, first, next);
  t.mock.method(Event, 'find', (filter) => {
    assert.equal(filter['meta.nowsta.excluded'].$ne, true);
    return query([]);
  });
  assert.equal((await carryBarReturnsForward(first)).status, 'no_next_day');
  assert.equal(writes(), 0);
});

test('authenticated submission saves the report before transferring stock and retry remains idempotent', async (t) => {
  const first = new BarEvent({ ...source(), status: 'ready' });
  const next = target();
  let saved = false;
  first.save = async () => { saved = true; };
  const writes = mockStorage(t, first, next);
  const req = { params: { id: sourceId }, auth: { role: 'bar admin', username: 'Office' }, body: {} };
  const res = response();
  await handler(router, '/events/:id/submit', 'post')(req, res);
  assert.equal(saved, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'submitted');
  assert.equal(res.body.carryoverResult.status, 'transferred');
  const retry = response();
  await handler(router, '/events/:id/carryover', 'post')(req, retry);
  assert.equal(retry.body.carryoverResult.status, 'unchanged');
  assert.equal(writes(), 1);
  const forbidden = response();
  await handler(router, '/events/:id/carryover', 'post')({ ...req, auth: { role: 'viewer' } }, forbidden);
  assert.equal(forbidden.statusCode, 403);
});

test('guest final returns transfer stock and offline replay never duplicates stock or resends email', async (t) => {
  const first = new BarEvent({ ...source(), status: 'ready', items: [{ ...source().items[0], returnedOpenQty: 0, returnConfirmed: false }] });
  const next = target();
  let saves = 0;
  first.save = async () => { saves++; };
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const writes = mockStorage(t, first, next);
  t.mock.method(BarEvent, 'findOne', async () => saves ? first : null);
  const req = { params: { eventId: sourceId }, guestAccess: { eventId: sourceId }, body: { clientMutationId: 'offline-1', reporterName: 'Captain', items: [{ itemId, sentQty: 12, deliveredQty: null, returnedQty: 11 }] } };
  const res = response();
  await handler(guestRouter, '/:eventId/returns', 'patch')(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.carryoverResult.status, 'transferred');
  assert.equal(next.items[0].deliveredQty, 11);
  const savedCount = saves;
  const duplicate = response();
  await handler(guestRouter, '/:eventId/returns', 'patch')(req, duplicate);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.carryoverResult.status, 'unchanged');
  assert.equal(saves, savedCount);
  assert.equal(writes(), 1);
  const forbidden = response();
  await handler(guestRouter, '/:eventId/returns', 'patch')({ ...req, guestAccess: { eventId: targetId } }, forbidden);
  assert.equal(forbidden.statusCode, 403);
});

test('a transfer failure stays visible without turning a saved report into a failed submission', async (t) => {
  const first = new BarEvent(source());
  first.save = async () => {};
  mockStorage(t, first, { ...target(), status: 'submitted' });
  t.mock.method(console, 'error', () => {});
  const res = response();
  await handler(router, '/events/:id/submit', 'post')({ params: { id: sourceId }, auth: { role: 'bar admin' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'submitted');
  assert.equal(res.body.carryoverResult.status, 'failed');
});
