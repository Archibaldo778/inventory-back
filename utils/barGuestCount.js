const numericGuestCount = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

export const EVENT_GUEST_COUNT_FIELDS = [
  'meta.guestCount', 'meta.guest_count', 'meta.guests', 'meta.numberOfGuests',
  'meta.number_of_guests', 'meta.pax',
  'catereaseOperations.guestCount', 'catereaseOperations.eventDetails.guestCount',
];

export const dashboardEventGuestCount = (event = {}) => {
  const candidates = EVENT_GUEST_COUNT_FIELDS
    .map((path) => path.split('.').reduce((value, key) => value?.[key], event))
    .map(numericGuestCount).filter((value) => value !== null);
  return candidates.find((value) => value > 0) ?? candidates[0] ?? null;
};
