import test from 'node:test';
import assert from 'node:assert/strict';
import { productCategoryUpdate } from '../utils/productCategoryUpdate.js';

test('changing a disposable product category moves the same product into decor', () => {
  const item = { _id: 'existing', inventoryCode: 'OCC00764', inventoryType: 'disposable', category: 'Disposable', quantity: 47, images: ['photo.jpg'] };
  const result = { ...item, ...productCategoryUpdate(item, ' Bar Equipment ') };
  assert.deepEqual(result, { ...item, category: 'Bar Equipment', inventoryType: 'decor' });
  assert.equal(item.inventoryType, 'disposable');
});

test('unchanged categories, blanks and internal categories do not transfer disposable stock', () => {
  for (const category of ['Disposable', ' disposable ', '', '__event_board_tape_library__:colors']) {
    assert.equal(productCategoryUpdate({ inventoryType: 'disposable', category: 'Disposable' }, category).inventoryType, undefined);
  }
  assert.deepEqual(productCategoryUpdate({ inventoryType: 'disposable', category: 'Trays' }, 'Trays'), { category: 'Trays' });
});

test('decor category edits keep existing catalog behavior', () => {
  assert.deepEqual(productCategoryUpdate({ inventoryType: 'decor', category: 'Trays' }, 'Bowls'), { category: 'Bowls' });
  assert.deepEqual(productCategoryUpdate({ category: 'Trays' }, 'Bowls'), { category: 'Bowls' });
});

test('product PATCH persists category and catalog together without replacing the product', async () => {
  const { default: router } = await import('../routes/products.js');
  const { default: Product } = await import('../models/Product.js');
  const item = { _id: 'existing', inventoryType: 'disposable', category: 'Disposable', quantity: 47, inventoryCode: 'OCC00764', images: ['photo.jpg'] };
  const find = Product.findById;
  const update = Product.findByIdAndUpdate;
  let saved;
  Product.findById = async () => item;
  Product.findByIdAndUpdate = async (id, changes) => {
    assert.equal(id, item._id);
    assert.deepEqual(changes, { category: 'Bar Equipment', inventoryType: 'decor' });
    return { toObject: () => ({ ...item, ...changes }) };
  };
  try {
    const route = router.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.patch).route;
    await route.stack.at(-1).handle({ params: { id: item._id }, body: { category: 'Bar Equipment' } }, {
      json(value) { saved = value; },
      status(code) { throw new Error(`Unexpected status ${code}`); },
    });
    assert.equal(saved.inventoryType, 'decor');
    assert.equal(saved.inventoryCode, item.inventoryCode);
    assert.equal(saved.quantity, 47);
    assert.deepEqual(saved.images, item.images);
  } finally {
    Product.findById = find;
    Product.findByIdAndUpdate = update;
  }
});

for (const inventoryType of ['decor', undefined]) {
  test(`Disposable category moves ${inventoryType || 'legacy decor'} stock without replacing data`, () => {
    const item = { _id: 'same', inventoryType, category: 'Trays', inventoryCode: 'OCC00001', quantity: 12, images: ['photo.jpg'] };
    assert.deepEqual({ ...item, ...productCategoryUpdate(item, ' disposable ') }, { ...item, category: 'disposable', inventoryType: 'disposable' });
    assert.equal(productCategoryUpdate(item, 'Disposable / event purchase').inventoryType, undefined);
  });
}
