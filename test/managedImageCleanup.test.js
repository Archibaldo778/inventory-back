import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { cleanupManagedImage } from '../utils/managedImageCleanup.js';

test('cleanupManagedImage deletes only owned Cloudinary and local upload targets', async () => {
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const originalDestroy = cloudinary.uploader.destroy;
  const destroyed = [];
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  cloudinary.uploader.destroy = async (publicId) => {
    destroyed.push(publicId);
    return { result: 'ok' };
  };

  try {
    const owned = await cleanupManagedImage(
      'https://res.cloudinary.com/demo/image/upload/v1720000000/kitchen/dish.jpg'
    );
    const external = await cleanupManagedImage('https://example.com/photo.jpg');
    const traversal = await cleanupManagedImage('/uploads/kitchen/%2e%2e/secret.jpg');
    const missing = await cleanupManagedImage('/uploads/kitchen/nonexistent-test-image.jpg');

    assert.equal(owned.removed, true);
    assert.deepEqual(destroyed, ['kitchen/dish']);
    assert.equal(external.kind, 'external');
    assert.equal(traversal.kind, 'external');
    assert.equal(missing.kind, 'local');
    assert.equal(missing.removed, false);
  } finally {
    cloudinary.uploader.destroy = originalDestroy;
    if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
  }
});
