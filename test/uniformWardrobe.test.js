import { requestAccessKeys } from '../utils/accessRolePolicy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUniformWardrobeRouter } from '../routes/uniformWardrobe.js';
import UniformWardrobeAsset from '../models/UniformWardrobeAsset.js';
import UniformItem from '../models/UniformItem.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (router, method, path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const png = { buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]) };

test('wardrobe is stored in a distinct collection without inventory quantities', () => {
  assert.notEqual(UniformWardrobeAsset.collection.name, UniformItem.collection.name);
  assert.equal(UniformWardrobeAsset.schema.path('quantity'), undefined);
  assert.equal(UniformWardrobeAsset.schema.path('sizes'), undefined);
});

test('wardrobe list excludes archived assets and identifies visual PNGs', async () => {
  const router = createUniformWardrobeRouter({ Model: { find(filter) {
    assert.deepEqual(filter, { archivedAt: null });
    return { sort: async () => [{ toObject: () => ({ name: 'Shirt', image: '/shirt.png' }) }] };
  } } });
  const res = response();
  await handler(router, 'get', '/')({}, res);
  assert.equal(res.body[0].wardrobeAsset, true);
  assert.equal(res.body[0].quantity, undefined);
});

test('wardrobe creation rejects absent or non-PNG images before uploading', async () => {
  const router = createUniformWardrobeRouter({ uploadImage: () => assert.fail('invalid images must not upload') });
  for (const file of [undefined, { buffer: Buffer.from('not a PNG image') }]) {
    const res = response();
    await handler(router, 'post', '/')({ params: {}, body: { name: 'Shirt', category: 'Shirts' }, file }, res);
    assert.equal(res.code, 400);
  }
});

test('PNG upload creates a wardrobe record using only permitted fields', async () => {
  let saved;
  const router = createUniformWardrobeRouter({ Model: { create: async (fields) => {
    saved = fields; return { toObject: () => fields };
  } }, uploadImage: async () => 'https://example.com/shirt.png' });
  const res = response();
  await handler(router, 'post', '/')({ params: {}, body: { name: ' White shirt ', category: 'Shirts', quantity: 500, sizes: '[]' }, file: png }, res);
  assert.equal(res.code, 201);
  assert.deepEqual(saved, { name: 'White shirt', category: 'Shirts', image: 'https://example.com/shirt.png' });
});

test('removing wardrobe PNG archives it without deleting files used by saved boards', async () => {
  const router = createUniformWardrobeRouter({ Model: { findOneAndUpdate: async (filter, update) => {
    assert.deepEqual(filter, { _id: 'asset-1', archivedAt: null });
    assert.ok(update.$set.archivedAt instanceof Date);
    assert.deepEqual(Object.keys(update.$set), ['archivedAt']);
    return { image: 'https://example.com/keep.png' };
  } } });
  const res = response();
  await handler(router, 'delete', '/:id')({ params: { id: 'asset-1' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('editing wardrobe details retains the PNG when no replacement is uploaded', async () => {
  const current = { image: '/keep.png', async save() {}, toObject() { return { name: this.name, image: this.image }; } };
  const router = createUniformWardrobeRouter({ Model: { findOne: async () => current }, uploadImage: () => assert.fail('no replacement') });
  const res = response();
  await handler(router, 'patch', '/:id')({ params: { id: 'asset-1' }, body: { name: 'New name', category: 'Shirts' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.image, '/keep.png');
  assert.equal(res.body.name, 'New name');
});

test('PNG wardrobe uses uniform view and edit permissions', () => {
  assert.deepEqual(requestAccessKeys({ originalUrl: '/api/uniform-wardrobe', method: 'GET' }, {}), ['uniforms.view']);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    assert.deepEqual(requestAccessKeys({ originalUrl: '/api/uniform-wardrobe/asset-1', method }, {}), ['uniforms.view', 'uniforms.edit']);
  }
});
