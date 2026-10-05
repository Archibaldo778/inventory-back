import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/uniformPacking.js';
import UniformItem from '../models/UniformItem.js';
import { packingCatalogFields, findOrCreatePackingItem } from '../utils/uniformPackingCatalog.js';
import { uniformPackerRequestAllowed, validateUniformLines } from '../utils/uniformPacking.js';
import { validateUniformBags } from '../utils/uniformBags.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const create = router.stack.find((layer) => layer.route?.path === '/catalog-items').route.stack[0].handle;

test('packer creates a reusable tie with zero stock and can save it in a bag', async (t) => {
  t.mock.method(UniformItem, 'findOne', async () => null);
  let stored;
  t.mock.method(UniformItem, 'create', async (fields) => (stored = { ...fields, _id: '507f1f77bcf86cd799439011' }));
  const res = response();
  await create({ body: { name: '  Black   Tie ', quantity: 900, hidden: true, sizes: [{ label: 'M', quantity: 55 }] } }, res);
  assert.equal(res.code, 201);
  assert.deepEqual(stored, { _id: '507f1f77bcf86cd799439011', name: 'Black Tie', sizes: [{ label: 'One size', quantity: 0 }], quantity: 0, hidden: false });
  const lines = validateUniformLines([{ itemId: stored._id, size: 'One size', quantity: 4 }], [stored]);
  const bags = validateUniformBags([{ id: 'bag1', number: 1, lines, notes: '' }], lines, [stored]);
  assert.equal(bags[0].lines[0].quantity, 4);
  assert.equal(stored.quantity, 0);
});

test('repeated creation reuses the catalog item without changing its stock or sizes', async () => {
  const existing = { name: 'Black Tie', sizes: [{ label: 'One size', quantity: 30 }], quantity: 30 };
  const model = { findOne: async (query) => { assert.equal(query.name.$options, 'i'); assert.equal(query.name.$regex, '^black tie$'); return existing; }, create: () => assert.fail('must not create another item') };
  const result = await findOrCreatePackingItem({ name: 'black tie', size: 'Large', quantity: 500 }, model);
  assert.equal(result.item, existing); assert.equal(result.created, false); assert.equal(existing.quantity, 30);
  assert.deepEqual(existing.sizes, [{ label: 'One size', quantity: 30 }]);
});

test('custom labels are validated and names used for lookup are escaped literally', async () => {
  for (const name of ['', '  ', {}, 'a'.repeat(121)]) assert.throws(() => packingCatalogFields({ name }), { statusCode: 400 });
  for (const size of ['a'.repeat(61), {}]) assert.throws(() => packingCatalogFields({ name: 'Apron', size }), { statusCode: 400 });
  assert.equal(packingCatalogFields({ name: 'Apron', size: ' 38/16 ' }).sizes[0].label, '38/16');
  await findOrCreatePackingItem({ name: 'Apron (custom) + .' }, { findOne: async (query) => {
    assert.equal(query.name.$regex, '^Apron \\(custom\\) \\+ \\.$'); return { name: 'Apron (custom) + .' };
  } });
  await assert.rejects(findOrCreatePackingItem({ name: 'Tie' }, { findOne: async () => ({ hidden: true }) }), { statusCode: 409 });
});

test('catalog quick creation is limited to uniform packing roles, including uniform packers', () => {
  assert.equal(uniformPackerRequestAllowed({ role: 'uniform packer' }, { method: 'POST', originalUrl: '/api/uniform-packing/catalog-items' }), true);
  for (const role of ['admin', 'super admin', 'kitchen admin', 'staffing admin', 'uniform packer', 'captain', 'bartender', 'packer', 'user']) {
    const res = response(); let passed = false;
    router.stack[0].handle({ auth: { role } }, res, () => { passed = true; });
    assert.equal(passed, ['admin', 'super admin', 'kitchen admin', 'staffing admin', 'uniform packer'].includes(role));
    if (!passed) assert.equal(res.code, 403);
  }
});
