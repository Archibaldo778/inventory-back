import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRODUCT_IMAGES, normalizeProductImages } from '../utils/productImages.js';

test('product gallery keeps the primary image first and removes duplicates', () => {
  assert.deepEqual(normalizeProductImages({
    image: 'primary.jpg',
    imageUrl: 'primary.jpg',
    images: ['secondary.jpg', 'primary.jpg'],
  }), ['primary.jpg', 'secondary.jpg']);
});

test('product gallery is bounded to the supported image count', () => {
  const images = Array.from({ length: MAX_PRODUCT_IMAGES + 3 }, (_, index) => `${index}.jpg`);
  assert.equal(normalizeProductImages({ images }).length, MAX_PRODUCT_IMAGES);
});
