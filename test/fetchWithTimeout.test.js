import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchWithTimeout,
  normalizeFetchTimeout,
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
