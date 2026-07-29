import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType, isAllowedImageUpload } from '../utils/imageSignature.js';

const padded = (...bytes) => Buffer.from([...bytes, ...new Array(32).fill(0)]);

test('detectImageType recognizes supported image signatures', () => {
  assert.equal(detectImageType(padded(0xff, 0xd8, 0xff)), 'jpeg');
  assert.equal(
    detectImageType(padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    'png'
  );
  assert.equal(detectImageType(Buffer.from('GIF89a0000000000')), 'gif');
  assert.equal(detectImageType(Buffer.from('RIFF0000WEBP00000000')), 'webp');

  const heif = Buffer.alloc(32);
  heif.write('ftyp', 4, 'ascii');
  heif.write('heic', 8, 'ascii');
  assert.equal(detectImageType(heif), 'heif');
});

test('isAllowedImageUpload ignores spoofed MIME type and file name', () => {
  const spoofed = {
    mimetype: 'image/png',
    originalname: 'trusted.png',
    buffer: Buffer.from('<script>alert(1)</script>'),
  };
  assert.equal(isAllowedImageUpload(spoofed, ['png']), false);

  const jpeg = {
    mimetype: 'application/octet-stream',
    originalname: 'unknown.bin',
    buffer: padded(0xff, 0xd8, 0xff),
  };
  assert.equal(isAllowedImageUpload(jpeg, ['jpeg']), true);
  assert.equal(isAllowedImageUpload(jpeg, ['png']), false);
});
