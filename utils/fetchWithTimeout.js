const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 60 * 1024 * 1024;
const MIN_RESPONSE_LIMIT_BYTES = 1024 * 1024;
const MAX_RESPONSE_LIMIT_BYTES = 100 * 1024 * 1024;

export const normalizeFetchTimeout = (value, fallback = DEFAULT_TIMEOUT_MS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(parsed)));
};

export const normalizeFetchResponseLimit = (
  value,
  fallback = DEFAULT_RESPONSE_LIMIT_BYTES
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_RESPONSE_LIMIT_BYTES,
    Math.max(MIN_RESPONSE_LIMIT_BYTES, Math.trunc(parsed))
  );
};

const upstreamResponseError = (message) => Object.assign(
  new Error(message),
  { statusCode: 502 }
);

const normalizeContentType = (value) => String(value || '')
  .split(';', 1)[0]
  .trim()
  .toLowerCase();

export const readBoundedResponseBuffer = async (
  response,
  {
    maxBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
    allowedContentTypes = [],
  } = {}
) => {
  const limit = normalizeFetchResponseLimit(maxBytes);
  const contentType = normalizeContentType(response?.headers?.get?.('content-type'));
  const allowed = allowedContentTypes
    .map(normalizeContentType)
    .filter(Boolean);

  if (!contentType || (allowed.length && !allowed.includes(contentType))) {
    await response?.body?.cancel?.().catch?.(() => {});
    throw upstreamResponseError('Upstream service returned an unsupported content type');
  }

  const declaredLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response?.body?.cancel?.().catch?.(() => {});
    throw upstreamResponseError('Upstream response exceeded the allowed size');
  }

  const reader = response?.body?.getReader?.();
  if (!reader) {
    throw upstreamResponseError('Upstream service returned an unreadable response');
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > limit) {
        await reader.cancel().catch(() => {});
        throw upstreamResponseError('Upstream response exceeded the allowed size');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (!totalBytes) {
    throw upstreamResponseError('Upstream service returned an empty response');
  }

  return {
    buffer: Buffer.concat(chunks, totalBytes),
    contentType,
  };
};

export const fetchWithTimeout = async (
  input,
  init = {},
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}
) => {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is unavailable');
  }

  const controller = new AbortController();
  const duration = normalizeFetchTimeout(timeoutMs);
  const timeout = setTimeout(() => controller.abort(), duration);
  timeout.unref?.();

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error('Upstream request timed out'), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
