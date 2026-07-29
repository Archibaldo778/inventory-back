import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKitchenImage,
  extractCloudinaryPublicId,
  getKitchenTargetPublicId,
} from '../utils/cloudinaryImageMigration.js';

test('Kitchen image migration classifies supported source locations', () => {
  assert.equal(classifyKitchenImage(''), 'empty');
  assert.equal(classifyKitchenImage('/uploads/kitchen/item.jpg'), 'local_uploads');
  assert.equal(
    classifyKitchenImage('https://res.cloudinary.com/demo/image/upload/v12/inventory/kitchen/item.jpg'),
    'cloudinary_legacy_folder'
  );
  assert.equal(
    classifyKitchenImage('https://res.cloudinary.com/demo/image/upload/v12/kitchen/item.jpg'),
    'cloudinary_target_folder'
  );
});

test('Kitchen image migration parses and validates Cloudinary public IDs', () => {
  const publicId = extractCloudinaryPublicId(
    'https://res.cloudinary.com/demo/image/upload/c_fill,w_400/v123/inventory/kitchen/item.name.webp'
  );
  assert.equal(publicId, 'inventory/kitchen/item.name');
  assert.equal(getKitchenTargetPublicId(publicId), 'kitchen/item.name');
  assert.equal(getKitchenTargetPublicId('inventory/other/item'), '');
  assert.equal(extractCloudinaryPublicId('https://example.com/upload/inventory/kitchen/item.jpg'), '');
});
