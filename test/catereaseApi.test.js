import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadCatereaseEventFile,
  getCatereaseConfig,
  getCatereaseEventBundle,
  listCatereaseEventFiles,
  listCatereaseHubResource,
} from '../utils/catereaseApi.js';

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

test('Caterease is the primary file source when configured unless explicitly disabled', () => {
  const previous = process.env.CATEREASE_PRIMARY_FILES;
  const previousApiKey = process.env.CATEREASE_API_KEY;
  try {
    process.env.CATEREASE_API_KEY = 'cea_test';
    delete process.env.CATEREASE_PRIMARY_FILES;
    assert.equal(getCatereaseConfig().primaryFiles, true);
    process.env.CATEREASE_PRIMARY_FILES = 'false';
    assert.equal(getCatereaseConfig().primaryFiles, false);
    process.env.CATEREASE_PRIMARY_FILES = 'true';
    assert.equal(getCatereaseConfig().primaryFiles, true);
    delete process.env.CATEREASE_API_KEY;
    assert.equal(getCatereaseConfig().primaryFiles, false);
  } finally {
    if (previous === undefined) delete process.env.CATEREASE_PRIMARY_FILES;
    else process.env.CATEREASE_PRIMARY_FILES = previous;
    if (previousApiKey === undefined) delete process.env.CATEREASE_API_KEY;
    else process.env.CATEREASE_API_KEY = previousApiKey;
  }
});

test('Caterease Hub catalog client supports recipe resources and pagination', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [{ ItemNum: '42' }], pagination: { hasMore: false, nextCursor: null } }), { status: 200 });
  };
  try {
    const page = await listCatereaseHubResource('menuitem', { activeOnly: true, locNum: '1' });
    assert.equal(page.data[0].ItemNum, '42');
    assert.match(requestedUrl, /\/v1\/menuitem\?/);
    assert.match(requestedUrl, /activeOnly=true/);
    assert.match(requestedUrl, /locNum=1/);
  } finally { global.fetch = originalFetch; }
}));

test('Caterease event bundle client requests the composite event base id safely', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ event: { eventId: 'E00470' }, includes: {} }), { status: 200 });
  };
  try {
    const bundle = await getCatereaseEventBundle('E00470');
    assert.equal(bundle.event.eventId, 'E00470');
    assert.match(requestedUrl, /\/v1\/events\/E00470\/bundle$/);
  } finally { global.fetch = originalFetch; }
}));
