import test from 'node:test';
import assert from 'node:assert/strict';
import UniformSet from '../models/UniformSet.js';

test('uniform set requires a name and stores member offsets/geometry', async () => {
  const set = new UniformSet({
    name: 'White Shirt Combo',
    anchorWidth: 200,
    anchorHeight: 400,
    members: [
      {
        src: 'https://res.cloudinary.com/demo/shirt.png',
        offsetX: 10,
        offsetY: -20,
        width: 120,
        height: 160,
        rotation: 5,
      },
      {
        src: 'https://res.cloudinary.com/demo/belt.png',
        offsetX: 0,
        offsetY: 90,
        width: 100,
        height: 30,
      },
    ],
  });

  await set.validate();

  assert.equal(set.members.length, 2);
  assert.equal(set.members[0].offsetX, 10);
  assert.equal(set.members[0].offsetY, -20);
  assert.equal(set.members[0].rotation, 5);
  assert.equal(set.members[1].flipX, false);
  assert.equal(set.members[1].flipY, false);
});

test('uniform set rejects a member with no image source', async () => {
  const set = new UniformSet({
    name: 'Broken Combo',
    members: [{ offsetX: 0, offsetY: 0, width: 10, height: 10 }],
  });

  await assert.rejects(() => set.validate());
});

test('uniform set rejects a missing name', async () => {
  const set = new UniformSet({
    members: [{ src: 'https://res.cloudinary.com/demo/shirt.png', offsetX: 0, offsetY: 0, width: 10, height: 10 }],
  });

  await assert.rejects(() => set.validate());
});
