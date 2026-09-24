import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../middleware/auth.js';

const TOKEN_TYPE = 'event-guest-access';
const ISSUER = 'occdecks-api';
const AUDIENCE = 'occdecks-event-guest';
const clean = (value, max = 4096) => String(value ?? '').trim().slice(0, max);

export const issueEventGuestAccess = ({ eventIds = [], capability = 'operations:view', expiresAt, subjectId = '', context = '' } = {}) => {
  const ids = [...new Set(eventIds.map((value) => clean(value, 80)).filter(Boolean))];
  if (!ids.length) throw new Error('At least one event is required for guest access');
  const now = Math.floor(Date.now() / 1000);
  const requestedExpiry = Math.floor(new Date(expiresAt || 0).getTime() / 1000);
  const exp = Number.isFinite(requestedExpiry) && requestedExpiry > now
    ? Math.min(requestedExpiry, now + (120 * 24 * 60 * 60))
    : now + (45 * 24 * 60 * 60);
  return jwt.sign(
    { tokenType: TOKEN_TYPE, eventIds: ids, capability: clean(capability, 40), ...(subjectId ? { subjectId: clean(subjectId, 100) } : {}), ...(context ? { context: clean(context, 120) } : {}), exp },
    getJwtSecret(),
    { issuer: ISSUER, audience: AUDIENCE, subject: TOKEN_TYPE, noTimestamp: true }
  );
};

export const verifyEventGuestAccess = (token, eventId, capability) => {
  const payload = jwt.verify(clean(token), getJwtSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: TOKEN_TYPE,
  });
  const ids = Array.isArray(payload?.eventIds) ? payload.eventIds.map(String) : [];
  if (payload?.tokenType !== TOKEN_TYPE || !ids.includes(String(eventId)) || payload?.capability !== capability) {
    throw new Error('This event link is not valid');
  }
  return payload;
};
