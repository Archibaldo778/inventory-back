import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { createBrotherProductLabel } from '../utils/brotherLabelTemplate.js';

test('creates a Brother label containing one pre-rendered monochrome image', async () => {
  const output = await createBrotherProductLabel('occ00439', 'https://occdecks.com/');
  const archive = await JSZip.loadAsync(output);
  const labelXml = await archive.file('label.xml').async('string');
  const bitmap = await archive.file('Object1.bmp').async('nodebuffer');

  assert.match(labelXml, /<image:image>/);
  assert.match(labelXml, /objectName="LabelImage"/);
  assert.match(labelXml, /fileName="Object1\.bmp"/);
  assert.doesNotMatch(labelXml, /<barcode:barcode>/);
  assert.doesNotMatch(labelXml, /<text:text>/);
  assert.equal(bitmap.subarray(0, 2).toString('ascii'), 'BM');
  assert.equal(bitmap.readInt32LE(18), 332);
  assert.equal(bitmap.readInt32LE(22), 320);
  assert.equal(bitmap.readUInt32LE(6), 0);
  assert.ok(bitmap.includes(Buffer.from([0x00, 0x00, 0x00, 0x00])));
});

test('rejects invalid inventory codes', async () => {
  await assert.rejects(() => createBrotherProductLabel('../bad'), /Invalid inventory code/);
});
