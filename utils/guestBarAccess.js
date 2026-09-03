import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../middleware/auth.js';

const TOKEN_TYPE = 'guest-bar-returns';
const TOKEN_ISSUER = 'occdecks-api';
const TOKEN_AUDIENCE = 'occdecks-guest-bar-returns';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MIN_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

const sessionTtlSeconds = () => {
  const configured = Number(process.env.PUBLIC_BAR_RETURNS_SESSION_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.round(configured)));
};

const accessFingerprint = () => {
  const pin = clean(process.env.PUBLIC_BAR_RETURNS_PIN, 64);
  const version = clean(process.env.PUBLIC_BAR_RETURNS_SESSION_VERSION, 64) || '1';
  if (!pin) throw new Error('Guest returns are not configured');
  return crypto.createHmac('sha256', getJwtSecret())
    .update(`guest-bar-returns:${version}:${pin}`)
    .digest('base64url')
    .slice(0, 24);
};

export const issueGuestBarSession = () => {
  const expiresIn = sessionTtlSeconds();
  const token = jwt.sign(
    { tokenType: TOKEN_TYPE, accessVersion: accessFingerprint() },
    getJwtSecret(),
    { expiresIn, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE, subject: TOKEN_TYPE }
  );
  return { token, expiresIn };
};

export const verifyGuestBarSession = (token) => {
  const payload = jwt.verify(clean(token, 4096), getJwtSecret(), {
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    subject: TOKEN_TYPE,
  });
  if (payload?.tokenType !== TOKEN_TYPE || payload?.accessVersion !== accessFingerprint()) {
    throw new Error('Guest session has been revoked');
  }
  return payload;
};

export const readGuestBarSession = (req) => clean(req.get?.('X-Bar-Returns-Session'), 4096);

export const guestSecurityActor = (req) => {
  const address = clean(req?.ip || req?.socket?.remoteAddress || 'unknown', 160);
  return crypto.createHmac('sha256', getJwtSecret())
    .update(`guest-security:${address}`)
    .digest('hex')
    .slice(0, 16);
};

export const logGuestSecurityEvent = (req, event, details = {}) => {
  let actor = 'unavailable';
  try { actor = guestSecurityActor(req); } catch { /* Logging must never block access handling. */ }
  const entry = {
    type: 'guest_bar_security',
    event: clean(event, 80),
    actor,
    method: clean(req?.method, 12),
    path: clean(req?.originalUrl || req?.path, 240),
    at: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [clean(key, 40), clean(value, 120)])),
  };
  console.info(JSON.stringify(entry));
};

export const GUEST_BAR_SESSION_HEADER = 'X-Bar-Returns-Session';
