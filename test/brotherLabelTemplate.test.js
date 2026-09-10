import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { createBrotherProductLabel } from '../utils/brotherLabelTemplate.js';

test('creates a static Brother label with the requested product QR and ID', async () => {
  const output = await createBrotherProductLabel('occ00439', 'https://occdecks.com/');
  const archive = await JSZip.loadAsync(output);
  const labelXml = await archive.file('label.xml').async('string');

  assert.match(labelXml, /<pt:data>https:\/\/occdecks\.com\/i\/OCC00439<\/pt:data>/);
  assert.match(labelXml, /<pt:data>OCC00439<\/pt:data>/);
  assert.doesNotMatch(labelXml, /OCC00440/);
});

test('rejects invalid inventory codes', async () => {
  await assert.rejects(() => createBrotherProductLabel('../bad'), /Invalid inventory code/);
});
