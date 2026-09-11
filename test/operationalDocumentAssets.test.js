import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudinaryWordThumbnailUrl } from '../utils/operationalDocumentAssets.js';

test('Cloudinary Word thumbnail transformation is applied exactly once', () => {
  const source = 'https://res.cloudinary.com/demo/image/upload/v1/inventory/item.png';
  const once = cloudinaryWordThumbnailUrl(source);
  assert.equal(once, 'https://res.cloudinary.com/demo/image/upload/f_jpg,c_pad,b_white,w_180,h_180,q_auto/v1/inventory/item.png');
  assert.equal(cloudinaryWordThumbnailUrl(once), once);
});
