import crypto from 'node:crypto';

const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';

const clean = (value) => String(value || '').trim();

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const message = body?.error_summary || body?.error_description || body?.error || `Dropbox request failed (${response.status})`;
    throw createHttpError(response.status, String(message).slice(0, 500));
  }
  return body;
};

export const normalizeDropboxRootPath = (value = '/Proposals') => {
  const normalized = `/${clean(value).replace(/^\/+|\/+$/g, '')}`;
  if (normalized === '/') return '';
  if (normalized.length > 1000 || normalized.includes('..')) throw createHttpError(400, 'Invalid Dropbox root path');
  return normalized;
};

const encryptionKey = () => {
  const configured = clean(process.env.DROPBOX_TOKEN_ENCRYPTION_KEY);
  if (configured.length < 32) throw createHttpError(503, 'DROPBOX_TOKEN_ENCRYPTION_KEY must be configured with at least 32 characters');
  return crypto.createHash('sha256').update(configured).digest();
};

export const encryptDropboxSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
};

export const decryptDropboxSecret = (secret = {}) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(clean(secret.iv), 'base64')
  );
  decipher.setAuthTag(Buffer.from(clean(secret.tag), 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(clean(secret.ciphertext), 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const stateKey = () => {
  const key = clean(process.env.JWT_SECRET);
  if (!key) throw createHttpError(503, 'JWT_SECRET is required');
  return key;
};

const encode = (value) => Buffer.from(value).toString('base64url');

export const createDropboxOauthState = ({ userId, returnTo = '' }) => {
  const payload = encode(JSON.stringify({
    userId: clean(userId),
    returnTo: clean(returnTo).slice(0, 500),
    nonce: crypto.randomBytes(18).toString('base64url'),
    expiresAt: Date.now() + (10 * 60 * 1000),
  }));
  const signature = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyDropboxOauthState = (state) => {
  const [payload, signature] = clean(state).split('.');
  if (!payload || !signature) throw createHttpError(400, 'Invalid OAuth state');
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw createHttpError(400, 'Invalid OAuth state');
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw createHttpError(400, 'Invalid OAuth state'); }
  if (!parsed?.userId || Number(parsed?.expiresAt) < Date.now()) throw createHttpError(400, 'OAuth state expired');
  return parsed;
};

export const getDropboxConfig = () => ({
  appKey: clean(process.env.DROPBOX_APP_KEY),
  appSecret: clean(process.env.DROPBOX_APP_SECRET),
  callbackUrl: clean(process.env.DROPBOX_REDIRECT_URI) || 'https://inventory-back-y61h.onrender.com/api/integrations/dropbox/callback',
  rootPath: normalizeDropboxRootPath(process.env.DROPBOX_ROOT_PATH || '/Proposals'),
});

export const buildDropboxAuthorizeUrl = ({ state }) => {
  const config = getDropboxConfig();
  if (!config.appKey || !config.appSecret) throw createHttpError(503, 'Dropbox App Key and App Secret are not configured');
  const params = new URLSearchParams({
    client_id: config.appKey,
    response_type: 'code',
    redirect_uri: config.callbackUrl,
    token_access_type: 'offline',
    state,
  });
  return `${DROPBOX_AUTHORIZE_URL}?${params}`;
};

const tokenRequest = async (params) => {
  const config = getDropboxConfig();
  if (!config.appKey || !config.appSecret) throw createHttpError(503, 'Dropbox App Key and App Secret are not configured');
  return fetchJson(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.appKey, client_secret: config.appSecret, ...params }),
  });
};

export const exchangeDropboxAuthorizationCode = (code) => {
  const config = getDropboxConfig();
  return tokenRequest({ code: clean(code), grant_type: 'authorization_code', redirect_uri: config.callbackUrl });
};

export const refreshDropboxAccessToken = async (refreshToken) => {
  const result = await tokenRequest({ refresh_token: clean(refreshToken), grant_type: 'refresh_token' });
  return clean(result.access_token);
};

const dropboxRpc = (endpoint, accessToken, body) => fetchJson(`${DROPBOX_API_URL}/${endpoint}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getDropboxCurrentAccount = (accessToken) => dropboxRpc('users/get_current_account', accessToken, null);

export const listDropboxFolder = (accessToken, { path, cursor = '' } = {}) => (
  cursor
    ? dropboxRpc('files/list_folder/continue', accessToken, { cursor })
    : dropboxRpc('files/list_folder', accessToken, {
        path: normalizeDropboxRootPath(path),
        recursive: true,
        include_deleted: true,
        include_mounted_folders: true,
        limit: 2000,
      })
);

export const downloadDropboxFile = async (accessToken, path) => {
  const response = await fetch(`${DROPBOX_CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path }) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw createHttpError(response.status, `Dropbox download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};
