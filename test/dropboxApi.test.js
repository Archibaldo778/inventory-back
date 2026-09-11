import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadDropboxFile } from '../utils/dropboxApi.js';

test('Dropbox download headers safely encode Unicode file names', async () => {
  const originalFetch = global.fetch;
  let apiArgument = '';
  global.fetch = async (_url, options) => {
    apiArgument = options.headers['Dropbox-API-Arg'];
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  try {
    await downloadDropboxFile('token', '/Event – First Floor PO.docx');
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(apiArgument.includes('–'), false);
  assert.match(apiArgument, /\\u2013/);
});
