import crypto from 'node:crypto';

export const barReturnsAppOrigin = () => String(
  process.env.PUBLIC_APP_ORIGIN
    || process.env.FRONTEND_URL
    || process.env.FRONTEND_ORIGIN
    || process.env.CLIENT_URL
    || process.env.APP_URL
    || 'https://occdecks.com'
).trim().replace(/\/+$/, '');

export const hashBarEventShareToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

export const verifyBarEventShareToken = (token, expectedHash) => {
  const actual = Buffer.from(hashBarEventShareToken(token), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
};

export const createBarEventShareLink = ({ dashboardEventId } = {}) => {
  const eventId = String(dashboardEventId || '').trim();
  if (!eventId) throw new Error('This bar report is not linked to a Dashboard event');
  const token = crypto.randomBytes(18).toString('base64url');
  return {
    url: `${barReturnsAppOrigin()}/bar/r/${encodeURIComponent(token)}`,
    tokenHash: hashBarEventShareToken(token),
  };
};
