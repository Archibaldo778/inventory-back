import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import DecorPackout from '../models/DecorPackout.js';
import { buildDecorPackoutCanvas } from '../utils/decorPackoutBoard.js';

const objectId = () => new mongoose.Types.ObjectId();

test('decor packout stores its event, deck, page and OCC item snapshot', () => {
  const packout = new DecorPackout({
    eventId: objectId(),
    deckId: objectId(),
    pageId: objectId(),
    eventTitle: 'Test Event',
    items: [{
      productId: objectId(),
      inventoryCode: 'occ00042',
      name: 'Tall candle holder',
      quantity: 3,
    }],
  });

  assert.equal(packout.validateSync(), undefined);
  assert.equal(packout.items[0].inventoryCode, 'OCC00042');
  assert.equal(packout.items[0].quantity, 3);
  assert.equal(packout.status, 'draft');
});

test('decor packout rejects invalid status and quantities', () => {
  const packout = new DecorPackout({
    eventId: objectId(),
    deckId: objectId(),
    pageId: objectId(),
    status: 'sent somewhere',
    items: [{
      productId: objectId(),
      inventoryCode: 'OCC00001',
      name: 'Tray',
      quantity: 0,
    }],
  });

  const error = packout.validateSync();
  assert.ok(error?.errors?.status);
  assert.ok(error?.errors?.['items.0.quantity']);
});

test('decor packout supports event-only items without polluting Product inventory', () => {
  const packout = new DecorPackout({
    eventId: objectId(),
    deckId: objectId(),
    pageId: objectId(),
    items: [{
      source: 'event',
      name: 'Disposable gold votive',
      category: 'Disposable / event purchase',
      quantity: 24,
    }],
  });

  assert.equal(packout.validateSync(), undefined);
  assert.equal(packout.items[0].productId, null);
  assert.equal(packout.items[0].inventoryCode, '');
  assert.equal(packout.items[0].source, 'event');
});

test('decor packout items are materialized on the linked Decor Board page', () => {
  const packoutId = objectId();
  const itemId = objectId();
  const productId = objectId();
  const result = buildDecorPackoutCanvas({ images: [] }, {
    _id: packoutId,
    items: [{ _id: itemId, productId, inventoryCode: 'OCC00042', name: 'Tall candle holder', image: '/uploads/holder.png', quantity: 3 }],
  });

  assert.equal(result.changed, true);
  assert.equal(result.canvas.images.length, 1);
  assert.equal(result.canvas.images[0].decorPackoutId, String(packoutId));
  assert.equal(result.canvas.images[0].decorPackoutItemId, String(itemId));
  assert.equal(result.canvas.images[0].quantity, 3);
  assert.equal(result.canvas.images[0].src, '/uploads/holder.png');
});

test('decor board sync updates quantities, removes deleted rows and supports products without photos', () => {
  const packoutId = objectId();
  const retainedItemId = objectId();
  const removedItemId = objectId();
  const noPhotoItemId = objectId();
  const result = buildDecorPackoutCanvas({ images: [
    { id: 'manual', src: '/manual.png' },
    { id: 'retained', decorPackoutId: String(packoutId), decorPackoutItemId: String(retainedItemId), src: '/old.png', quantity: 1 },
    { id: 'removed', decorPackoutId: String(packoutId), decorPackoutItemId: String(removedItemId), src: '/removed.png' },
  ] }, {
    _id: packoutId,
    items: [
      { _id: retainedItemId, productId: objectId(), inventoryCode: 'OCC00043', name: 'Tray', quantity: 6 },
      { _id: noPhotoItemId, productId: objectId(), inventoryCode: 'OCC00044', name: 'Vase', quantity: 2 },
    ],
  });

  assert.equal(result.canvas.images.length, 3);
  assert.equal(result.canvas.images[0].id, 'manual');
  assert.equal(result.canvas.images[1].quantity, 6);
  assert.equal(result.canvas.images[1].src, '/old.png');
  assert.match(result.canvas.images[2].src, /^data:image\/svg\+xml/);
});
