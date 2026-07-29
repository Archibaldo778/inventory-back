const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export const normalizeFetchTimeout = (value, fallback = DEFAULT_TIMEOUT_MS) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(parsed)));
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
