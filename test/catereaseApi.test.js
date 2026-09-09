import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadCatereaseEventFile, listCatereaseEventFiles } from '../utils/catereaseApi.js';

const withApiKey = async (callback) => {
  const previous = process.env.CATEREASE_API_KEY;
  process.env.CATEREASE_API_KEY = 'cea_test';
  try { await callback(); } finally {
    if (previous === undefined) delete process.env.CATEREASE_API_KEY;
    else process.env.CATEREASE_API_KEY = previous;
  }
};

test('Caterease listing uses EventDto id, UID fields and bearer authentication', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ data: [{ UID: 96 }], pagination: { nextCursor: 'next', hasMore: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const page = await listCatereaseEventFiles('E00470');
    assert.equal(page.data[0].UID, 96);
    assert.equal(page.pagination.nextCursor, 'next');
    assert.match(request.url, /eventId=E00470/);
    assert.match(request.url, /UID%2CFileName/);
    assert.equal(request.options.headers.Authorization, 'Bearer cea_test');
  } finally { global.fetch = originalFetch; }
}));

test('Caterease content download returns bytes and ETag', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('document'), {
    status: 200,
    headers: { 'content-type': 'application/pdf', etag: 'revision-etag' },
  });
  try {
    const file = await downloadCatereaseEventFile(96);
    assert.equal(file.buffer.toString(), 'document');
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.etag, 'revision-etag');
  } finally { global.fetch = originalFetch; }
}));
