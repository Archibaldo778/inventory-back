import test from 'node:test';
import assert from 'node:assert/strict';
import UniformItem from '../models/UniformItem.js';

test('uniform inventory stores quantities per size and calculates total stock', async () => {
  const item = new UniformItem({
    name: 'Service jacket',
    sizes: [
      { label: 'S', quantity: 2 },
      { label: 'M', quantity: 5 },
      { label: 'L', quantity: 3 },
    ],
  });

  await item.validate();

  assert.deepEqual(item.sizes.map(({ label, quantity }) => ({ label, quantity })), [
    { label: 'S', quantity: 2 },
    { label: 'M', quantity: 5 },
    { label: 'L', quantity: 3 },
  ]);
  assert.equal(item.quantity, 10);
});
