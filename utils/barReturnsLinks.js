import { issueEventGuestAccess } from './eventGuestAccess.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const barReturnsAppOrigin = () => String(
  process.env.PUBLIC_APP_ORIGIN
    || process.env.FRONTEND_URL
    || process.env.FRONTEND_ORIGIN
    || process.env.CLIENT_URL
    || process.env.APP_URL
    || 'https://occdecks.com'
).trim().replace(/\/+$/, '');

export const createBarEventShareLink = ({ dashboardEventId, issuerId = '', now = new Date() } = {}) => {
  const eventId = String(dashboardEventId || '').trim();
  if (!eventId) throw new Error('This bar report is not linked to a Dashboard event');
  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + (3 * DAY_MS));
  const token = issueEventGuestAccess({
    eventIds: [eventId],
    capability: 'bar:returns',
    expiresAt,
    subjectId: issuerId,
    context: 'captain-share',
  });
  return {
    url: `${barReturnsAppOrigin()}/bar/returns?event=${encodeURIComponent(eventId)}&access=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
  };
};
