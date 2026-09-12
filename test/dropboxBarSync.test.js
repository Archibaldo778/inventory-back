import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropboxBarSourceChecksum,
  hasAppliedDropboxBarSourceChecksum,
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
