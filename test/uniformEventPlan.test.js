import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/uniformPacking.js';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import Staff from '../models/Staff.js';
import Event from '../models/Event.js';
import { validateUniformEventItems, validateUniformEventPlan } from '../utils/uniformEventPlan.js';
import { packingCatalogFields } from '../utils/uniformPackingCatalog.js';
import { validateUniformLines } from '../utils/uniformPacking.js';

const globalItem = { _id: '507f1f77bcf86cd799439011', name: 'White Shirt', sizes: [{ label: 'M' }] };
const custom = { _id: '507f1f77bcf86cd799439022', name: 'Client Jacket', sizeField: 'jacketSize', sizes: [{ label: '38R', quantity: 0 }] };
const plan = { rows: [{ itemId: custom._id, audience: 'position', position: 'Bartender' }], notes: 'Confirmed by Sales' };
const chain = (value) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });
const handler = router.stack.find((layer) => layer.route?.path === '/events/:id/packout').route.stack[0].handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('event-only items and manual instructions round-trip through the packout model without a catalog record', async () => {
  const items = validateUniformEventItems([{ ...custom, sizes: [{ label: '38R', quantity: 900 }] }], [globalItem]);
  assert.equal(items[0].sizes[0].quantity, 0);
  const doc = new UniformPackout({ nowstaEventId: '42', revision: 1, eventItems: items, uniformPlan: validateUniformEventPlan(plan, [...items, globalItem]) });
  await doc.validate();
  const saved = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(saved.eventItems, [custom]); assert.deepEqual(saved.uniformPlan, plan);
  assert.equal(new UniformPackout({ nowstaEventId: 'legacy' }).uniformPlan, undefined);
  assert.throws(() => validateUniformLines([{ itemId: custom._id, size: '38R', quantity: 2 }], [globalItem]), /existing uniform/);
});

test('event items cannot impersonate catalog IDs, invent staff fields or send uncontrolled inventory counts', () => {
  for (const item of [{ ...custom, _id: globalItem._id }, { ...custom, _id: 'bad' }, { ...custom, sizeField: 'email' }, { ...custom, name: '' }, { ...custom, sizes: [{ label: 'x'.repeat(61) }] }]) {
    assert.throws(() => validateUniformEventItems([item], [globalItem]), { statusCode: 400 });
  }
  assert.throws(() => validateUniformEventItems([custom, custom], []), { statusCode: 400 });
  assert.throws(() => validateUniformEventPlan({ ...plan, rows: [{ ...plan.rows[0], audience: 'everyoneElse' }] }, [custom]), { statusCode: 400 });
  assert.throws(() => validateUniformEventPlan(plan, [globalItem]), { statusCode: 400 });
  assert.deepEqual(validateUniformEventPlan({ rows: [], notes: '' }, []), { rows: [], notes: '' });
  const fields = packingCatalogFields({ name: 'Client Jacket', sizeField: 'jacketSize', sizes: [{ label: '38R', quantity: 500 }] });
  assert.equal(fields.sizeField, 'jacketSize'); assert.equal(fields.sizes[0].quantity, 0);
});

test('saving a plan and custom bag is one revision-locked write, and catalog stock is untouched', async (t) => {
  const current = { revision: 4, uniformPlan: null, eventItems: [], bags: [] };
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain({ nowstaEventId: '42' }));
  t.mock.method(UniformItem, 'find', () => chain([globalItem]));
  t.mock.method(UniformItem, 'create', () => assert.fail('event item must not enter the global catalog'));
  t.mock.method(UniformItem, 'updateOne', () => assert.fail('stock must not change'));
  t.mock.method(UniformPackout, 'findOne', () => chain(current));
  t.mock.method(UniformPackout, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { nowstaEventId: '42', revision: 4 });
    assert.equal(update.$inc.revision, 1);
    assert.deepEqual(update.$set.uniformPlan, plan);
    assert.equal(update.$set.bags[0].lines[0].name, 'Client Jacket');
    return { ...current, ...update.$set, revision: 5 };
  });
  const line = { itemId: custom._id, size: '38R', quantity: 2 };
  const res = response();
  await handler({ params: { id: '42' }, auth: { username: 'Packer' }, body: { expectedRevision: 4, lines: [line], bags: [{ id: 'bag1', number: 1, lines: [line], notes: '' }], eventItems: [custom], uniformPlan: plan } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.revision, 5); assert.deepEqual(res.body.uniformPlan, plan);
});

test('older clients preserve an existing plan and its custom items; stale saves still return 409', async (t) => {
  const current = { revision: 5, eventItems: [custom], uniformPlan: plan, bags: [] };
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain({ nowstaEventId: '42' }));
  t.mock.method(UniformItem, 'find', () => chain([globalItem]));
  t.mock.method(UniformPackout, 'findOne', () => chain(current));
  t.mock.method(UniformPackout, 'findOneAndUpdate', async (filter, update) => {
    assert.ok(!Object.hasOwn(update.$set, 'uniformPlan')); assert.ok(!Object.hasOwn(update.$set, 'eventItems'));
    return filter.revision === 5 ? { ...current, ...update.$set, revision: 6 } : null;
  });
  for (const expectedRevision of [5, 4]) {
    const res = response();
    await handler({ params: { id: '42' }, auth: { username: 'Packer' }, body: { expectedRevision, lines: [{ itemId: custom._id, size: '38R', quantity: 1 }] } }, res);
    assert.equal(res.code, expectedRevision === 5 ? 200 : 409);
    if (res.code === 200) assert.deepEqual(res.body.uniformPlan, plan);
  }
});

test('reloading an event returns its custom items and saved plan without leaking them into another event', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', (query) => chain({ nowstaEventId: query.nowstaEventId, shifts: [] }));
  t.mock.method(UniformItem, 'find', () => chain([globalItem]));
  t.mock.method(UniformPackout, 'findOne', (query) => chain(query.nowstaEventId === '42' ? { revision: 3, eventItems: [custom], uniformPlan: plan } : null));
  t.mock.method(Staff, 'find', () => chain([])); t.mock.method(Event, 'find', () => chain([]));
  t.mock.method(UniformItem, 'create', () => assert.fail('reading must not create catalog entries'));
  const get = router.stack.find((layer) => layer.route?.path === '/events/:id').route.stack[0].handle;
  for (const id of ['42', '43']) {
    const res = response(); await get({ params: { id } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.catalog.length, id === '42' ? 2 : 1);
    if (id === '42') assert.deepEqual(res.body.packout.uniformPlan, plan);
  }
});
