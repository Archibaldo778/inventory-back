import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import DecorPackout from '../models/DecorPackout.js';
import {
  buildDecorPackoutCanvas,
  decorPackoutNeedsBoardSync,
  preserveUnplacedDecorPackoutItems,
  removeGeneratedDecorPackoutDuplicates,
  selectReusableDecorPackoutDraft,
} from '../utils/decorPackoutBoard.js';

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

test('decor board sync preserves user quantities, removes deleted rows and supports products without photos', () => {
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
  assert.equal(result.canvas.images[1].quantity, 1);
  assert.equal(result.canvas.images[1].src, '/old.png');
  assert.match(result.canvas.images[2].src, /^data:image\/svg\+xml/);
});

test('decor board sync adopts an existing Canvas product instead of adding a duplicate', () => {
  const packoutId = objectId();
  const itemId = objectId();
  const result = buildDecorPackoutCanvas({ images: [
    { id: 'canvas-product-1', productId: String(objectId()), name: 'Stage vase', quantity: 4, x: 320, y: 180 },
  ] }, {
    _id: packoutId,
    items: [{ _id: itemId, boardItemId: 'canvas-product-1', name: 'Stage vase', quantity: 9 }],
  });

  assert.equal(result.canvas.images.length, 1);
  assert.equal(result.canvas.images[0].id, 'canvas-product-1');
  assert.equal(result.canvas.images[0].x, 320);
  assert.equal(result.canvas.images[0].decorPackoutId, String(packoutId));
  assert.equal(result.canvas.images[0].decorPackoutItemId, String(itemId));
  assert.equal(result.canvas.images[0].quantity, 4);
});

test('five merge and build cycles keep two user copies stable on one or two pages', () => {
  const runCycles = (initialPages) => {
    const packoutId = 'packout-stable';
    const itemId = 'item-stable';
    const productId = String(objectId());
    let pages = initialPages.map((images) => ({ images: images.map((image) => ({ ...image, productId })) }));
    const changes = [];
    let quantity = 0;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      quantity = pages.flatMap((page) => page.images)
        .filter((image) => image.productId === productId)
        .reduce((sum, image) => sum + Number(image.quantity || 1), 0);
      const packout = {
        _id: packoutId,
        items: [{ _id: itemId, productId, boardItemId: 'a', name: 'Stage vase', quantity }],
      };
      let cycleChanged = false;
      pages = pages.map((page, pageIndex) => {
        const result = buildDecorPackoutCanvas(page, {
          ...packout,
          items: pageIndex === 0 ? packout.items : [],
        });
        cycleChanged ||= result.changed;
        return result.canvas;
      });
      changes.push(cycleChanged);
    }
    return { changes, pages, quantity };
  };

  const onePage = runCycles([[{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1 }]]);
  const twoPages = runCycles([[{ id: 'a', quantity: 1 }], [{ id: 'b', quantity: 1 }]]);
  [onePage, twoPages].forEach((result) => {
    assert.equal(result.quantity, 2);
    assert.deepEqual(result.changes, [true, false, false, false, false]);
    assert.deepEqual(result.pages.flatMap((page) => page.images).map((image) => image.quantity), [1, 1]);
  });
});

test('Canvas import removes only a generated duplicate when the dragged product already exists', () => {
  const packoutId = objectId();
  const productId = objectId();
  const original = { id: '1727000000000', productId: String(productId), name: 'Stage vase' };
  const generated = { id: `packout-${packoutId}-${objectId()}`, productId: String(productId), name: 'Stage vase' };
  const unrelated = { id: `packout-${packoutId}-${objectId()}`, productId: String(objectId()), name: 'Tray' };
  const result = removeGeneratedDecorPackoutDuplicates([original, generated, unrelated], packoutId);

  assert.deepEqual(result.map((item) => item.id), [original.id, unrelated.id]);
});

test('Canvas import never removes user-placed copies even when one is linked to the packout', () => {
  const packoutId = objectId();
  const productId = objectId();
  const original = { id: 'canvas-product', productId: String(productId), name: 'Stage vase' };
  const legacyDuplicate = {
    id: 'legacy-linked-copy',
    productId: String(productId),
    decorPackoutId: String(packoutId),
    decorPackoutItemId: String(objectId()),
    name: 'Stage vase',
  };
  const result = removeGeneratedDecorPackoutDuplicates([legacyDuplicate, original], packoutId);

  assert.deepEqual(result.map((item) => item.id), [legacyDuplicate.id, original.id]);
  assert.deepEqual(removeGeneratedDecorPackoutDuplicates(result, packoutId), result);
});

test('Canvas reconciliation preserves unplaced scans and removes only a missing placed item', () => {
  const unplaced = { _id: 'unplaced', name: 'New scan', boardItemId: '' };
  const removedFromCanvas = { _id: 'placed', name: 'Removed vase', boardItemId: 'canvas-vase' };
  const result = preserveUnplacedDecorPackoutItems([unplaced, removedFromCanvas], [], new Set());

  assert.deepEqual(result, [unplaced]);
  assert.equal(decorPackoutNeedsBoardSync(result), true);
  assert.equal(decorPackoutNeedsBoardSync([{ ...unplaced, boardItemId: 'canvas-new-scan' }]), false);
  assert.equal(decorPackoutNeedsBoardSync(result, new Set(['unplaced'])), false);
});

test('creating a packout reuses the populated draft for the same event board', () => {
  const empty = { _id: 'newer-empty', status: 'draft', items: [] };
  const populated = { _id: 'existing', status: 'draft', items: [{ _id: 'item-1' }] };
  const complete = { _id: 'complete', status: 'complete', items: [{ _id: 'item-2' }] };
  assert.equal(selectReusableDecorPackoutDraft([empty, populated, complete]), populated);
  assert.equal(selectReusableDecorPackoutDraft([empty, complete]), empty);
  assert.equal(selectReusableDecorPackoutDraft([complete]), null);
});
