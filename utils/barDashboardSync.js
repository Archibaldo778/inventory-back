import { EVENT_GUEST_COUNT_FIELDS } from './barGuestCount.js';

const isoDay = (date) => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('-');

const shiftIsoDay = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
};

export const DASHBOARD_BAR_SYNC_SELECT = [
  '_id', 'externalId', 'title', 'date', 'client', 'managerId', 'status',
  ...EVENT_GUEST_COUNT_FIELDS,
  'meta.venue', 'meta.location', 'meta.eventVenue', 'meta.event_venue',
  'meta.nowsta.shifts',
].join(' ');

export const buildActiveDashboardBarEventQuery = () => ({
  status: { $not: /^(?:deleted|cancelled|canceled|lost)$/i },
  'meta.nowsta.excluded': { $ne: true },
});

export const buildDashboardBarSyncQuery = ({ eventId = null, today = isoDay(new Date()) } = {}) => ({
  ...buildActiveDashboardBarEventQuery(),
  ...(eventId
    ? { _id: eventId }
    : { date: { $gte: shiftIsoDay(today, -30), $lte: shiftIsoDay(today, 90) } }),
});
