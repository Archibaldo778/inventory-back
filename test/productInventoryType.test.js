import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../models/Product.js';

test('legacy and new products default to the permanent decor catalog', () => {
  const item = new Product({ name: 'Existing tray' });
  assert.equal(item.inventoryType, 'decor');
  assert.equal(item.validateSync(), undefined);
});

test('products support a persistent disposable catalog', () => {
  const item = new Product({ name: 'Cocktail napkins', inventoryType: 'disposable', quantity: 500 });
  assert.equal(item.inventoryType, 'disposable');
  assert.equal(item.validateSync(), undefined);
});

test('products reject unknown inventory catalog types', () => {
  const item = new Product({ name: 'Unknown', inventoryType: 'temporary' });
  assert.ok(item.validateSync()?.errors?.inventoryType);
});
