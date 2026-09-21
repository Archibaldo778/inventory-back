import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadDropboxFile, uploadDropboxFile } from '../utils/dropboxApi.js';

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

test('Dropbox generated document saves are non-destructive by default', async () => {
  const originalFetch = global.fetch;
  let apiArgument = {};
  global.fetch = async (_url, options) => {
    apiArgument = JSON.parse(options.headers['Dropbox-API-Arg']);
    return {
      ok: true,
      text: async () => JSON.stringify({ id: 'id:new', rev: 'rev-new' }),
    };
  };
  try {
    await uploadDropboxFile('token', '/Proposals/Event PO.docx', Buffer.from('document'));
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(apiArgument.mode, 'add');
  assert.equal(apiArgument.autorename, true);
  assert.equal(apiArgument.path, '/Proposals/Event PO.docx');
});
