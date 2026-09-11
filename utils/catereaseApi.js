const DEFAULT_BASE_URL = 'https://caterease.app';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const clean = (value) => String(value || '').trim();

export const getCatereaseConfig = () => {
  const apiKey = clean(process.env.CATEREASE_API_KEY);
  // The Caterease Hub (recipes/menu) sync can stay on even while file sync is disabled, so
  // this is a separate switch from `apiKey` — e.g. while /v1/eventfile does not return the
  // generated Pack Out / Kitchen Menu documents and Dropbox remains the active file source.
  const filesEnabled = Boolean(apiKey) && clean(process.env.CATEREASE_FILES_ENABLED).toLowerCase() === 'true';
  return {
    apiKey,
    baseUrl: clean(process.env.CATEREASE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    primaryFiles: filesEnabled,
  };
};

const catereaseFetch = async (path, options = {}) => {
  const config = getCatereaseConfig();
  if (!config.apiKey) throw Object.assign(new Error('CATEREASE_API_KEY is not configured'), { statusCode: 409 });
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  return response;
};

const responseError = async (response, fallback) => {
  let message = fallback;
  try {
    const body = await response.json();
    message = clean(body?.error?.message || body?.message || body?.error) || fallback;
  } catch { /* upstream may return an empty or non-JSON error */ }
  return Object.assign(new Error(message), { statusCode: response.status, retryAfter: response.headers.get('retry-after') });
};

export const listCatereaseEventFiles = async (eventId, { cursor = '', limit = 200 } = {}) => {
  const params = new URLSearchParams({
    fields: 'UID,EvtNum,FileName,Comment,Booked,Shared,NSort,Revised',
    limit: String(Math.max(1, Math.min(200, Number(limit) || 200))),
  });
  if (clean(eventId)) params.set('eventId', clean(eventId));
  if (clean(cursor)) params.set('cursor', clean(cursor));
  const response = await catereaseFetch(`/v1/eventfile?${params.toString()}`);
  if (!response.ok) throw await responseError(response, `Caterease file listing failed (${response.status})`);
  const body = await response.json();
  return {
    data: Array.isArray(body?.data) ? body.data : [],
    pagination: {
      nextCursor: clean(body?.pagination?.nextCursor),
      hasMore: Boolean(body?.pagination?.hasMore),
    },
  };
};

const HUB_RESOURCES = new Set([
  'location',
  'menuitem',
  'menuitemrecipe',
  'ingredient',
  'ingredientrecipe',
  'ingredientunit',
]);

const OPERATIONAL_RESOURCES = new Set([
  'eventrequireditem',
  'foodservquery',
  'foodservusage',
]);

export const listCatereaseHubResource = async (resource, options = {}) => {
  const name = clean(resource).toLowerCase();
  if (!HUB_RESOURCES.has(name)) throw Object.assign(new Error('Unsupported Caterease Hub resource'), { statusCode: 400 });
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, Number(options.limit) || 200))) });
  if (clean(options.cursor)) params.set('cursor', clean(options.cursor));
  if (clean(options.fields)) params.set('fields', clean(options.fields));
  if (clean(options.locNum)) params.set('locNum', clean(options.locNum));
  if (clean(options.modifiedSince) && ['menuitem', 'ingredient'].includes(name)) params.set('modifiedSince', clean(options.modifiedSince));
  if (options.activeOnly === true && name === 'menuitem') params.set('activeOnly', 'true');
  (Array.isArray(options.itemIds) ? options.itemIds : []).slice(0, 200).forEach((itemId) => {
    if (clean(itemId)) params.append('itemId', clean(itemId));
  });
  const response = await catereaseFetch(`/v1/${name}?${params.toString()}`);
  if (!response.ok) throw await responseError(response, `Caterease ${name} listing failed (${response.status})`);
  const body = await response.json();
  return {
    data: Array.isArray(body?.data) ? body.data : [],
    pagination: {
      nextCursor: clean(body?.pagination?.nextCursor),
      hasMore: Boolean(body?.pagination?.hasMore),
    },
  };
};

export const listCatereaseOperationalResource = async (resource, eventId, options = {}) => {
  const name = clean(resource).toLowerCase();
  if (!OPERATIONAL_RESOURCES.has(name)) {
    throw Object.assign(new Error('Unsupported Caterease operational resource'), { statusCode: 400 });
  }
  const safeEventId = clean(eventId);
  if (!safeEventId) throw Object.assign(new Error('Caterease event ID is required'), { statusCode: 400 });
  const params = new URLSearchParams({
    eventId: safeEventId,
    limit: String(Math.max(1, Math.min(200, Number(options.limit) || 200))),
  });
  if (clean(options.cursor)) params.set('cursor', clean(options.cursor));
  if (clean(options.fields)) params.set('fields', clean(options.fields));
  if (clean(options.dateFrom)) params.set('dateFrom', clean(options.dateFrom));
  if (clean(options.dateTo)) params.set('dateTo', clean(options.dateTo));
  const response = await catereaseFetch(`/v1/${name}?${params.toString()}`);
  if (!response.ok) throw await responseError(response, `Caterease ${name} listing failed (${response.status})`);
  const body = await response.json();
  return {
    data: Array.isArray(body?.data) ? body.data : [],
    pagination: {
      nextCursor: clean(body?.pagination?.nextCursor),
      hasMore: Boolean(body?.pagination?.hasMore),
    },
  };
};

export const getCatereaseEventBundle = async (eventId) => {
  const safeEventId = clean(eventId);
  if (!safeEventId) throw Object.assign(new Error('Caterease event ID is required'), { statusCode: 400 });
  const response = await catereaseFetch(`/v1/events/${encodeURIComponent(safeEventId)}/bundle`);
  if (!response.ok) throw await responseError(response, `Caterease event bundle failed (${response.status})`);
  return response.json();
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const downloadCatereaseEventFile = async (uid, { attempts = 3 } = {}) => {
  const safeUid = Number(uid);
  if (!Number.isSafeInteger(safeUid) || safeUid <= 0) throw Object.assign(new Error('Invalid Caterease file UID'), { statusCode: 400 });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await catereaseFetch(`/v1/eventfile/${safeUid}/content`, { headers: { Accept: '*/*' } });
    if (response.status === 409 && attempt < attempts) {
      const retrySeconds = Math.max(1, Math.min(5, Number(response.headers.get('retry-after')) || 2));
      await wait(retrySeconds * 1000);
      continue;
    }
    if (!response.ok) throw await responseError(response, `Caterease file download failed (${response.status})`);
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_BYTES) {
      throw Object.assign(new Error('Caterease file exceeds the 25 MB limit'), { statusCode: 413 });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) throw Object.assign(new Error('Caterease file exceeds the 25 MB limit'), { statusCode: 413 });
    return {
      buffer,
      contentType: clean(response.headers.get('content-type')) || 'application/octet-stream',
      etag: clean(response.headers.get('etag')),
      contentDisposition: clean(response.headers.get('content-disposition')),
    };
  }
  throw Object.assign(new Error('Caterease file is temporarily locked'), { statusCode: 409 });
};
