import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchWithTimeout,
  normalizeFetchResponseLimit,
  normalizeFetchTimeout,
  readBoundedResponseBuffer,
} from '../utils/fetchWithTimeout.js';

test('normalizeFetchTimeout bounds unsafe configuration values', () => {
  assert.equal(normalizeFetchTimeout('invalid', 30_000), 30_000);
  assert.equal(normalizeFetchTimeout(10), 1_000);
  assert.equal(normalizeFetchTimeout(500_000), 120_000);
  assert.equal(normalizeFetchTimeout(12_345), 12_345);
});

test('fetchWithTimeout passes a signal and returns successful responses', async () => {
  const expected = { ok: true };
  const result = await fetchWithTimeout('https://example.test/image', {}, {
    timeoutMs: 1_000,
    fetchImpl: async (_input, init) => {
      assert.equal(init.signal.aborted, false);
      return expected;
    },
  });

  assert.equal(result, expected);
});

test('fetchWithTimeout aborts stalled requests with a safe gateway status', async () => {
  await assert.rejects(
    fetchWithTimeout('https://example.test/image', {}, {
      timeoutMs: 1_000,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    }),
    (error) => error?.statusCode === 504 && error?.message === 'Upstream request timed out'
  );
});

test('normalizeFetchResponseLimit clamps unsafe configuration values', () => {
  assert.equal(normalizeFetchResponseLimit(10), 1024 * 1024);
  assert.equal(normalizeFetchResponseLimit(500 * 1024 * 1024), 100 * 1024 * 1024);
  assert.equal(normalizeFetchResponseLimit('invalid'), 60 * 1024 * 1024);
});

test('readBoundedResponseBuffer accepts an allowed image response', async () => {
  const response = new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'image/png; charset=binary' },
  });
  const result = await readBoundedResponseBuffer(response, {
    maxBytes: 1024 * 1024,
    allowedContentTypes: ['image/png'],
  });

  assert.deepEqual([...result.buffer], [1, 2, 3]);
  assert.equal(result.contentType, 'image/png');
});

test('readBoundedResponseBuffer rejects unexpected content types', async () => {
  const response = new Response('not an image', {
    headers: { 'content-type': 'text/html' },
  });

  await assert.rejects(
    readBoundedResponseBuffer(response, {
      allowedContentTypes: ['image/png'],
    }),
    (error) => error?.statusCode === 502
  );
});

test('readBoundedResponseBuffer rejects streamed bodies over the limit', async () => {
  const oversized = new Uint8Array((1024 * 1024) + 1);
  const response = new Response(oversized, {
    headers: { 'content-type': 'image/jpeg' },
  });

  await assert.rejects(
    readBoundedResponseBuffer(response, {
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['image/jpeg'],
    }),
    (error) => error?.statusCode === 502
  );
});
