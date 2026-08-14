import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import DecorPackout from '../models/DecorPackout.js';

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
