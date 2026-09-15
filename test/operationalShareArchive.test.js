import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';

import { createOperationalShareArchive } from '../utils/operationalShareArchive.js';

test('operational share archive preserves each generated Office file', async () => {
  const output = await createOperationalShareArchive([
    { name: 'Pack Out.docx', buffer: Buffer.from('word-file') },
    { name: 'Staff Request.xlsx', buffer: Buffer.from('excel-file') },
  ]);
  const archive = await JSZip.loadAsync(output);
  assert.equal(await archive.file('Pack Out.docx').async('string'), 'word-file');
  assert.equal(await archive.file('Staff Request.xlsx').async('string'), 'excel-file');
});

test('operational share archive sanitizes paths and keeps duplicate filenames', async () => {
  const output = await createOperationalShareArchive([
    { name: '../PO.docx', buffer: Buffer.from('first') },
    { name: '../PO.docx', buffer: Buffer.from('second') },
  ]);
  const archive = await JSZip.loadAsync(output);
  assert.deepEqual(Object.keys(archive.files), ['.._PO.docx', '.._PO (2).docx']);
  await assert.rejects(() => createOperationalShareArchive([]), /At least one share attachment/);
});
