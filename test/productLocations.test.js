import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductLocationPayload } from '../utils/productLocations.js';

test('uses legacy location and quantity when locations are absent', () => {
  assert.deepEqual(buildProductLocationPayload(undefined, { location: 'Main', quantity: 8 }), {
    locations: [{ name: 'Main', quantity: 8 }],
    location: 'Main',
    quantity: 8,
  });
});

test('keeps legacy stock that has no warehouse name', () => {
  assert.deepEqual(buildProductLocationPayload(undefined, { quantity: 6 }), {
    locations: [{ name: 'Unassigned', quantity: 6 }],
    location: 'Unassigned',
    quantity: 6,
  });
});

test('parses multipart JSON, merges locations, and calculates total', () => {
  assert.deepEqual(buildProductLocationPayload(JSON.stringify([
    { name: 'Queens', quantity: 2 },
    { name: 'queens', quantity: 3 },
    { name: 'Brooklyn', quantity: 4 },
  ])), {
    locations: [
      { name: 'Queens', quantity: 5 },
      { name: 'Brooklyn', quantity: 4 },
    ],
    location: 'Queens',
    quantity: 9,
  });
});
