import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropboxBarSourceChecksum,
  hasAppliedDropboxBarSourceChecksum,
  selectDropboxBarSourceDocuments,
} from '../utils/dropboxBarSync.js';

test('Dropbox bar checksum is stable across document ordering and changes with parsed items', () => {
  const left = { sourceId: 'a', sourceRevision: '1', type: 'po', barItems: [{ name: 'Gin', quantity: 2 }] };
  const right = { sourceId: 'b', sourceRevision: '1', type: 'kitchen_menu', barItems: [{ name: 'Spritz' }] };
  assert.equal(buildDropboxBarSourceChecksum([left, right]), buildDropboxBarSourceChecksum([right, left]));
  assert.notEqual(
    buildDropboxBarSourceChecksum([left, right]),
    buildDropboxBarSourceChecksum([{ ...left, barItems: [{ name: 'Gin', quantity: 3 }] }, right])
  );
});

test('Dropbox bar sync uses one published copy of a mirrored PO', () => {
  const wine = [{ name: 'Sancerre, Romain Reverdy (White)', sentQty: 1 }];
  const documents = [
    {
      sourceProvider: 'dropbox', sourceId: 'documents-copy', type: 'po',
      fileName: '10-01-26 Hermes Madison Cocktail PO.docx',
      sourcePath: '/Events/10-01-26 Hermes Madison Cocktail/Documents/10-01-26 Hermes Madison Cocktail PO.docx',
      barItems: wine,
    },
    {
      sourceProvider: 'dropbox', sourceId: 'leadership-copy', type: 'po',
      fileName: '10-01-26 Hermes Madison Cocktail PO.docx',
      sourcePath: '/Events/10-01-26 Hermes Madison Cocktail/Leadership File/10-01-26 Hermes Madison Cocktail PO.docx',
      barItems: wine,
    },
  ];
  const selected = selectDropboxBarSourceDocuments(documents);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceId, 'leadership-copy');
  assert.equal(selected[0].barItems[0].sentQty, 1);
});

test('Dropbox checksum is current only when Dropbox is the latest source sync', () => {
  const checksum = 'dropbox-checksum';
  assert.equal(hasAppliedDropboxBarSourceChecksum({
    audit: [{ action: 'dropbox_documents_synced', details: { checksum } }],
  }, checksum), true);
  assert.equal(hasAppliedDropboxBarSourceChecksum({
    audit: [
      { action: 'dropbox_documents_synced', details: { checksum } },
      { action: 'caterease_operations_synced', details: { checksum: 'caterease-checksum' } },
    ],
  }, checksum), false);
});
