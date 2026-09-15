import crypto from 'node:crypto';

const clean = (value) => String(value || '').trim();
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'openid profile email offline_access User.Read Mail.ReadWrite';

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export const getOutlookConfig = () => {
  const tenantId = clean(process.env.MICROSOFT_TENANT_ID || 'organizations');
  return {
    tenantId,
    clientId: clean(process.env.MICROSOFT_CLIENT_ID),
    clientSecret: clean(process.env.MICROSOFT_CLIENT_SECRET),
    redirectUri: clean(process.env.MICROSOFT_REDIRECT_URI)
      || 'https://inventory-back-y61h.onrender.com/api/integrations/caterease/outlook/callback',
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
  };
};

const encryptionKey = () => {
  const configured = clean(process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY || process.env.DROPBOX_TOKEN_ENCRYPTION_KEY);
  if (configured.length < 32) throw httpError(503, 'OUTLOOK_TOKEN_ENCRYPTION_KEY must be configured with at least 32 characters');
  return crypto.createHash('sha256').update(configured).digest();
};

export const encryptOutlookSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean(value), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
};

export const decryptOutlookSecret = (secret = {}) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(clean(secret.iv), 'base64'));
  decipher.setAuthTag(Buffer.from(clean(secret.tag), 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(clean(secret.ciphertext), 'base64')), decipher.final()]).toString('utf8');
};

const stateKey = () => {
  const key = clean(process.env.JWT_SECRET);
  if (!key) throw httpError(503, 'JWT_SECRET is required');
  return key;
};

const encode = (value) => Buffer.from(value).toString('base64url');

export const createOutlookState = ({ userId, returnTo = '' }) => {
  const payload = encode(JSON.stringify({ userId: clean(userId), returnTo: clean(returnTo).slice(0, 500), nonce: crypto.randomBytes(18).toString('base64url'), expiresAt: Date.now() + 10 * 60_000 }));
  const signature = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyOutlookState = (state) => {
  const [payload, signature] = clean(state).split('.');
  if (!payload || !signature) throw httpError(400, 'Invalid Outlook OAuth state');
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw httpError(400, 'Invalid Outlook OAuth state');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw httpError(400, 'Invalid Outlook OAuth state'); }
  if (!parsed?.userId || Number(parsed.expiresAt) < Date.now()) throw httpError(400, 'Outlook OAuth state expired');
  return parsed;
};

const requireConfig = () => {
  const config = getOutlookConfig();
  if (!config.clientId || !config.clientSecret) throw httpError(503, 'Microsoft Outlook is not configured');
  return config;
};

export const buildOutlookAuthorizeUrl = ({ state }) => {
  const config = requireConfig();
  const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirectUri, response_mode: 'query', scope: SCOPES, state, prompt: 'select_account' });
  return `${config.authorizeUrl}?${params}`;
};

const tokenRequest = async (params) => {
  const config = requireConfig();
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, scope: SCOPES, ...params }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, clean(body.error_description || body.error) || 'Microsoft sign-in failed');
  return body;
};

export const exchangeOutlookCode = (code) => tokenRequest({ code: clean(code), grant_type: 'authorization_code' });
export const refreshOutlookToken = (refreshToken) => tokenRequest({ refresh_token: clean(refreshToken), grant_type: 'refresh_token' });

const graphJson = async (path, accessToken, options = {}) => {
  const response = await fetch(`${GRAPH_ROOT}${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, clean(body?.error?.message) || `Microsoft Graph request failed (${response.status})`);
  return body;
};

export const getOutlookProfile = (accessToken) => graphJson('/me?$select=id,displayName,mail,userPrincipalName', accessToken);

const attachSmallFile = (accessToken, messageId, attachment) => graphJson(`/me/messages/${encodeURIComponent(messageId)}/attachments`, accessToken, {
  method: 'POST',
  body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: attachment.contentType, contentBytes: attachment.buffer.toString('base64') }),
});

const attachLargeFile = async (accessToken, messageId, attachment) => {
  const session = await graphJson(`/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name: attachment.name, size: attachment.buffer.length, contentType: attachment.contentType } }),
  });
  if (!session.uploadUrl) throw httpError(502, 'Microsoft did not create an attachment upload session');
  const chunkSize = 3_276_800;
  for (let start = 0; start < attachment.buffer.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, attachment.buffer.length) - 1;
    const response = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${attachment.buffer.length}` }, body: attachment.buffer.subarray(start, end + 1), signal: AbortSignal.timeout(120_000) });
    if (!response.ok && response.status !== 201 && response.status !== 202) throw httpError(response.status, `Outlook attachment upload failed (${response.status})`);
  }
};

export const createOutlookDraft = async ({ accessToken, subject, html, attachments = [] }) => {
  const draft = await graphJson('/me/messages', accessToken, { method: 'POST', body: JSON.stringify({ subject: clean(subject).slice(0, 255), body: { contentType: 'HTML', content: String(html || '') } }) });
  for (const attachment of attachments) {
    if (attachment.buffer.length <= 2_800_000) await attachSmallFile(accessToken, draft.id, attachment);
    else await attachLargeFile(accessToken, draft.id, attachment);
  }
  const complete = await graphJson(`/me/messages/${encodeURIComponent(draft.id)}?$select=id,webLink`, accessToken);
  return complete;
};
