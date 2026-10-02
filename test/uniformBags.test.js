import test from 'node:test';
import assert from 'node:assert/strict';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import router from '../routes/uniformPacking.js';
import { validateUniformBags } from '../utils/uniformBags.js';

const shirt = { _id: '507f1f77bcf86cd799439011', name: 'White shirt', sizes: [{ label: 'M' }, { label: 'L' }] };
const jacket = { _id: '507f1f77bcf86cd799439012', name: 'Black Mandarin', sizes: [{ label: '42' }] };
const catalog = [shirt, jacket];
const lines = [{ itemId: shirt._id, name: shirt.name, size: 'M', quantity: 10 }, { itemId: jacket._id, name: jacket.name, size: '42', quantity: 5 }];
const bag = (id, number, contents = lines) => ({ id, number, notes: '', lines: contents });
const chain = (data) => ({ select() { return this; }, lean: async () => data });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const save = router.stack.find((layer) => layer.route?.path === '/events/:id/packout' && layer.route.methods.put).route.stack[0].handle;

test('bag contents are canonical, can mix styles and sizes, and may leave some quantities unpacked', () => {
  const mixed = bag('bag-1', 1, [{ ...lines[0], name: 'spoofed', quantity: 3 }, { ...lines[1], quantity: 2 }]);
  const result = validateUniformBags([mixed], lines, catalog);
  assert.equal(result[0].lines[0].name, 'White shirt');
  assert.deepEqual(result[0].lines.map((line) => line.quantity), [3, 2]);
  assert.deepEqual(validateUniformBags([], lines, catalog), []);
});

test('the same stock cannot be counted twice across bags, and invalid labels are rejected', () => {
  assert.throws(() => validateUniformBags([bag('one', 1), bag('two', 2)], lines, catalog), /exceed/);
  assert.throws(() => validateUniformBags([bag('one', 1, [])], lines, catalog), /empty/);
  assert.throws(() => validateUniformBags([bag('one', 0)], lines, catalog), /number/);
  assert.throws(() => validateUniformBags([bag(1, 1)], lines, catalog), /unique ID/);
  assert.throws(() => validateUniformBags([{ ...bag('one', 1), notes: 'x'.repeat(401) }], lines, catalog), /400/);
  assert.throws(() => validateUniformBags([bag('one', 1, [{ ...lines[0], quantity: 1.5 }])], lines, catalog), /whole/);
  assert.throws(() => validateUniformBags([bag('one', 1, [{ ...lines[0], size: 'unknown' }])], lines, catalog), /existing/);
  assert.throws(() => validateUniformBags([bag('one', 1, [lines[0]]), bag('one', 2, [lines[1]])], lines, catalog), /unique ID/);
  assert.throws(() => validateUniformBags([bag('one', 1, [lines[0]]), bag('two', 1, [lines[1]])], lines, catalog), /unique positive/);
});

test('old packouts retain their totals without inventing bag contents', () => {
  const record = new UniformPackout({ nowstaEventId: '42', lines });
  assert.equal(record.bags, undefined);
  assert.equal(record.lines[0].quantity, 10);
});

test('save writes bags and total quantities together under the existing revision without changing inventory', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain({ nowstaEventId: '42' }));
  t.mock.method(UniformItem, 'find', () => chain(catalog));
  t.mock.method(UniformItem, 'updateOne', () => assert.fail('Packing must not deduct inventory'));
  t.mock.method(UniformPackout, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { nowstaEventId: '42', revision: 4 });
    assert.equal(update.$set.bags[0].lines[1].name, 'Black Mandarin');
    assert.equal(update.$set.lines[0].quantity, 10);
    assert.equal(update.$inc.revision, 1);
    return { ...update.$set, revision: 5 };
  });
  const res = response();
  await save({ params: { id: '42' }, auth: { username: 'Packer' }, body: { expectedRevision: 4, lines, bags: [bag('one', 1)], notes: 'Front entrance' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.revision, 5); assert.equal(res.body.bags.length, 1);
});

test('an older client cannot reduce totals beneath the contents of saved bags', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain({ nowstaEventId: '42' }));
  t.mock.method(UniformItem, 'find', () => chain(catalog));
  t.mock.method(UniformPackout, 'findOne', () => chain({ bags: [bag('one', 1)] }));
  t.mock.method(UniformPackout, 'findOneAndUpdate', () => assert.fail('Invalid bag totals must not be saved'));
  const res = response();
  await save({ params: { id: '42' }, auth: { username: 'Packer' }, body: { expectedRevision: 4, lines: [{ ...lines[0], quantity: 1 }], notes: '' } }, res);
  assert.equal(res.code, 400); assert.match(res.body.message, /exceed/);
});
