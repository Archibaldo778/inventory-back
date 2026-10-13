import test from 'node:test';
import assert from 'node:assert/strict';
import { dropboxContentHash, downloadDropboxDocumentSnapshot } from '../utils/dropboxDocumentSnapshot.js';
test('old event source downloads its exact retained revision without using a deleted path or restoring a file', async () => {
  const buffer = Buffer.from('saved PO');
  const document = { sourceId: 'id:deleted', sourceRevision: '0165d3083263d04000000037de3c773', checksum: dropboxContentHash(buffer) };
  const result = await downloadDropboxDocumentSnapshot('token', document, 'event-namespace', async (token, path, options) => {
    assert.equal(token, 'token'); assert.equal(path, 'rev:0165d3083263d04000000037de3c773'); assert.deepEqual(options, { namespaceId: 'event-namespace' }); return buffer;
  });
  assert.equal(result, buffer);
});
test('different file contents or missing revision never reach the parser', async () => {
  await assert.rejects(downloadDropboxDocumentSnapshot('', { sourceRevision: '123456789', checksum: 'a'.repeat(64) }, '', async () => Buffer.from('wrong PO')), /checksum/);
  await assert.rejects(downloadDropboxDocumentSnapshot('', { sourceId: 'id:file' }, '', () => assert.fail('must not download an unverified replacement')), /revision/);
});
test('Dropbox empty content hash uses the documented zero-block definition', () => {
  assert.equal(dropboxContentHash(Buffer.alloc(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
