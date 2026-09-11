import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadCatereaseEventFile,
  getCatereaseConfig,
  getCatereaseEventBundle,
  listCatereaseEventFiles,
  listCatereaseEvents,
  listCatereaseHubResource,
  listCatereaseOperationalResource,
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
    assert.match(request.url, /UID%2CEvtNum%2CFileName/);
    assert.match(request.url, /NSort/);
    assert.doesNotMatch(request.url, /SortOrder/);
    assert.equal(request.options.headers.Authorization, 'Bearer cea_test');
  } finally { global.fetch = originalFetch; }
}));

test('Caterease event file catalog can be listed without an event filter', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [], pagination: { hasMore: false } }), { status: 200 });
  };
  try {
    await listCatereaseEventFiles('');
    assert.doesNotMatch(requestedUrl, /eventId=/);
    assert.match(requestedUrl, /EvtNum/);
  } finally { global.fetch = originalFetch; }
}));

test('Caterease event catalog resolves full EvtNum values inside a date window', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [{ EvtNum: '00001-E000022672', EventNum: 'E22672' }], pagination: { hasMore: false } }), { status: 200 });
  };
  try {
    const page = await listCatereaseEvents({ dateFrom: '2026-09-11', dateTo: '2026-09-11', fields: 'EvtNum,EventNum' });
    assert.equal(page.data[0].EvtNum, '00001-E000022672');
    assert.match(requestedUrl, /\/v1\/event\?/);
    assert.match(requestedUrl, /dateFrom=2026-09-11/);
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

test('Caterease recipes remain configured while event files require an explicit opt-in', () => {
  const previousLegacyFlag = process.env.CATEREASE_PRIMARY_FILES;
  const previousFilesEnabled = process.env.CATEREASE_FILES_ENABLED;
  const previousApiKey = process.env.CATEREASE_API_KEY;
  try {
    process.env.CATEREASE_API_KEY = 'cea_test';
    delete process.env.CATEREASE_PRIMARY_FILES;
    delete process.env.CATEREASE_FILES_ENABLED;
    assert.equal(getCatereaseConfig().primaryFiles, false);

    // CATEREASE_PRIMARY_FILES is a retired flag and no longer has any effect.
    process.env.CATEREASE_PRIMARY_FILES = 'false';
    assert.equal(getCatereaseConfig().primaryFiles, false);
    delete process.env.CATEREASE_PRIMARY_FILES;

    // Event-file sync is opt-in. The API key remains usable for recipes/menu data.
    process.env.CATEREASE_FILES_ENABLED = 'true';
    assert.equal(getCatereaseConfig().primaryFiles, true);
    assert.equal(getCatereaseConfig().apiKey, 'cea_test');

    delete process.env.CATEREASE_FILES_ENABLED;
    delete process.env.CATEREASE_API_KEY;
    assert.equal(getCatereaseConfig().primaryFiles, false);
  } finally {
    if (previousLegacyFlag === undefined) delete process.env.CATEREASE_PRIMARY_FILES;
    else process.env.CATEREASE_PRIMARY_FILES = previousLegacyFlag;
    if (previousFilesEnabled === undefined) delete process.env.CATEREASE_FILES_ENABLED;
    else process.env.CATEREASE_FILES_ENABLED = previousFilesEnabled;
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

test('Caterease operational client scopes rows to one event and date', async () => withApiKey(async () => {
  const originalFetch = global.fetch;
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [{ ItemName: '8 Quart Chafing Dish', Qty: 4 }], pagination: { hasMore: false } }), { status: 200 });
  };
  try {
    const page = await listCatereaseOperationalResource('eventrequireditem', 'E22672', {
      fields: 'ItemName,Qty',
      dateFrom: '2026-09-11',
      dateTo: '2026-09-11',
    });
    assert.equal(page.data[0].Qty, 4);
    assert.match(requestedUrl, /\/v1\/eventrequireditem\?/);
    assert.match(requestedUrl, /eventId=E22672/);
    assert.match(requestedUrl, /dateFrom=2026-09-11/);
    assert.match(requestedUrl, /fields=ItemName%2CQty/);
  } finally { global.fetch = originalFetch; }
}));

test('Caterease operational client rejects unsupported resources', async () => withApiKey(async () => {
  await assert.rejects(
    () => listCatereaseOperationalResource('eventfile', 'E22672'),
    /Unsupported Caterease operational resource/
  );
}));
