const clean = (value) => String(value || '').trim();
const DAY_WORDS = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

export const normalizedBarSeriesTitle = (value) => clean(value)
  .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(new RegExp(`\\bday\\s+(?:\\d+|${DAY_WORDS})\\b`, 'g'), ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const isSeriesFirstDay = (value) => new RegExp(`\\bday\\s+(?:1|one)\\b`, 'i').test(clean(value));

export const barSeriesDayNumber = (value) => {
  const match = clean(value).match(new RegExp(`\\bday\\s+(\\d+|${DAY_WORDS})\\b`, 'i'));
  if (!match) return null;
  const numeric = Number(match[1]);
  if (Number.isFinite(numeric)) return numeric;
  return DAY_WORDS.slice(3, -1).split('|').indexOf(match[1].toLowerCase()) + 1 || null;
};

const dayDistance = (left, right) => Math.abs(
  (new Date(`${left}T12:00:00Z`).getTime() - new Date(`${right}T12:00:00Z`).getTime()) / 86400000,
);

export const selectBarEventSeries = (events = [], sourceEvent = {}, maxDayDistance = 14) => {
  const sourceTitle = normalizedBarSeriesTitle(sourceEvent?.name);
  const sourceDate = clean(sourceEvent?.eventDate);
  const sourceClient = clean(sourceEvent?.client).toLowerCase();
  if (!sourceTitle || !sourceDate || !isSeriesFirstDay(sourceEvent?.name)) return [];
  return (Array.isArray(events) ? events : [])
    .filter((event) => (
      normalizedBarSeriesTitle(event?.name) === sourceTitle
      && /^\d{4}-\d{2}-\d{2}$/.test(clean(event?.eventDate))
      && dayDistance(clean(event.eventDate), sourceDate) <= maxDayDistance
      && (!sourceClient || !clean(event?.client) || clean(event.client).toLowerCase() === sourceClient)
    ))
    .sort((left, right) => clean(left.eventDate).localeCompare(clean(right.eventDate)));
};

export const selectBarPackoutSeries = (events = [], sourceEvent = {}, maxDayDistance = 14) => {
  const sourceTitle = normalizedBarSeriesTitle(sourceEvent?.name);
  const sourceDate = clean(sourceEvent?.eventDate);
  const sourceClient = clean(sourceEvent?.client).toLowerCase();
  if (!sourceTitle || !sourceDate || !barSeriesDayNumber(sourceEvent?.name)) return [];
  return (Array.isArray(events) ? events : [])
    .filter((event) => (
      barSeriesDayNumber(event?.name)
      && normalizedBarSeriesTitle(event?.name) === sourceTitle
      && /^\d{4}-\d{2}-\d{2}$/.test(clean(event?.eventDate))
      && dayDistance(clean(event.eventDate), sourceDate) <= maxDayDistance
      && (!sourceClient || !clean(event?.client) || clean(event.client).toLowerCase() === sourceClient)
    ))
    .sort((left, right) => (
      clean(left.eventDate).localeCompare(clean(right.eventDate))
      || barSeriesDayNumber(left.name) - barSeriesDayNumber(right.name)
    ));
};

export const buildSharedBarPackoutPlan = (series = [], currentEventId = '') => {
  const rows = Array.isArray(series) ? series : [];
  if (rows.length < 2) throw new Error('No matching multi-day event series was found');
  const finalEvent = rows.at(-1);
  if (String(finalEvent?._id || '') !== String(currentEventId || '')) {
    throw new Error(`Open ${finalEvent?.name || 'the final day'} and import the shared PO there`);
  }
  return {
    targetEventId: String(finalEvent._id),
    eventIds: rows.map((event) => String(event._id)),
    startDate: clean(rows[0]?.eventDate),
    endDate: clean(finalEvent?.eventDate),
  };
};

export const allocateSeriesCharge = (events = [], total = 0) => {
  const rows = Array.isArray(events) ? events : [];
  const totalCents = Math.round(Number(total) * 100);
  if (!rows.length || !Number.isFinite(totalCents) || totalCents < 0) return [];
  const guestCounts = rows.map((event) => Number(event?.guestCount));
  const useGuests = guestCounts.every((count) => Number.isFinite(count) && count > 0);
  const weights = useGuests ? guestCounts : rows.map(() => 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return rows.map((event, index) => {
    const cents = index === rows.length - 1
      ? totalCents - assigned
      : Math.floor((totalCents * weights[index]) / weightTotal);
    assigned += cents;
    return {
      event,
      amount: cents / 100,
      method: useGuests ? 'guest_count' : 'equal',
      weight: weights[index],
      totalWeight: weightTotal,
    };
  });
};

export const findManualSeriesChargeConflict = (events = [], sourceEventId = '') => (
  (Array.isArray(events) ? events : []).find((event) => (
    String(event?._id) !== String(sourceEventId)
    && Number(event?.clientCharge) > 0
    && String(event?.clientChargeDetails?.source || 'manual') === 'manual'
  )) || null
);
