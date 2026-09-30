const numericGuestCount = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replaceAll(',', '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

export const dashboardEventGuestCount = (event = {}) => {
  const candidates = [
    event?.meta?.guestCount,
    event?.meta?.guest_count,
    event?.meta?.guests,
    event?.meta?.numberOfGuests,
    event?.meta?.number_of_guests,
    event?.meta?.pax,
    event?.catereaseOperations?.guestCount,
    event?.catereaseOperations?.eventDetails?.guestCount,
  ].map(numericGuestCount).filter((value) => value !== null);
  return candidates.find((value) => value > 0) ?? candidates[0] ?? null;
};
