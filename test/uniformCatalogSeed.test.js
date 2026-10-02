import test from 'node:test';
import assert from 'node:assert/strict';
import { planUniformCatalog } from '../utils/uniformCatalogSeed.js';

test('labelmaker catalog fills missing styles without duplicating, unhiding or changing existing stock', () => {
  const existing = [{ name: 'Blue & White Checkered Button Down Shirts', quantity: 7 },
    { name: 'Black Mandarin', hidden: true, sizes: [{ label: 'L', quantity: 8 }] },
    { name: 'White Button Down Shirt', quantity: 20 }];
  const snapshot = structuredClone(existing);
  const additions = planUniformCatalog(existing, [{ jacketSize: '42L', pantsSize: '32x32', shoeSize: '10.5' }]);
  assert.equal(additions.length, 21);
  assert.ok(additions.some((item) => item.name === 'Nehru Black'));
  assert.ok(additions.some((item) => item.name === 'Phone Check Box'));
  assert.ok(additions.find((item) => item.name === 'SUIT Jacket Black').sizes.some((size) => size.label === '42L'));
  assert.ok(additions.every((item) => item.quantity === 0 && item.sizes.every((size) => size.quantity === 0)));
  assert.ok(additions.every((item) => item.sizes.length <= 50));
  assert.deepEqual(additions.find((item) => item.name === 'Mandarin White').sizes, [{ label: 'L', quantity: 0 }]);
  assert.deepEqual(existing, snapshot);
  assert.deepEqual(planUniformCatalog([...existing, ...additions]), []);
});
