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
  'meta.guestCount', 'meta.guest_count', 'meta.guests',
  'meta.venue', 'meta.location', 'meta.eventVenue', 'meta.event_venue',
  'meta.nowsta.shifts',
].join(' ');

export const buildDashboardBarSyncQuery = ({ eventId = null, today = isoDay(new Date()) } = {}) => ({
  status: { $not: /^deleted$/i },
  ...(eventId
    ? { _id: eventId }
    : { date: { $gte: shiftIsoDay(today, -30), $lte: shiftIsoDay(today, 90) } }),
});
