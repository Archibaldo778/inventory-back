const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const CATEREASE_CALENDAR_EVENT_FIELDS = [
  'EvtNum',
  'EventNum',
  'PartyName',
  'Client',
  'EvtDate',
  'Status',
  'Category',
  'ActGuests',
  'GtdGuests',
  'PlnGuests',
  'SalesRep',
  'Revised',
].join(',');

const eventDate = (value) => {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
};

const guestCount = (row) => {
  for (const value of [row?.ActGuests, row?.GtdGuests, row?.PlnGuests]) {
    if (clean(value) === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
};

export const catereaseCalendarAvailability = ({ requiredItems = [], foodService = [], shifts = [] } = {}) => {
  const result = new Map();
  const mark = (rows, field) => (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = clean(row?.EvtNum);
    if (!key) return;
    result.set(key, { ...(result.get(key) || {}), [field]: true });
  });
  mark(requiredItems, 'po');
  mark(foodService, 'km');
  mark(shifts, 'sr');
  return result;
};

export const normalizeCatereaseCalendarEvent = (row = {}, availability = {}) => {
  const rawEventId = clean(row?.EvtNum);
  const actualGuests = guestCount(row);
  const status = clean(row?.Status);
  const category = clean(row?.Category);
  const salesRep = clean(row?.SalesRep);
  const client = clean(row?.Client);
  return {
    _id: `caterease:${rawEventId || clean(row?.EventNum)}`,
    externalId: clean(row?.EventNum),
    title: clean(row?.PartyName) || 'Untitled event',
    date: eventDate(row?.EvtDate),
    client,
    managerId: salesRep,
    status,
    importSource: 'caterease',
    meta: {
      guestCount: actualGuests,
      category,
      calendarReport: {
        sr: availability?.sr ? 'Yes' : '',
        km: availability?.km ? 'Yes' : '',
        po: availability?.po ? 'Yes' : '',
      },
      catereaseEventId: rawEventId,
      catereaseRevisedAt: clean(row?.Revised),
    },
    catereaseOperations: {
      eventStatus: status,
      eventType: category,
      guestCount: actualGuests,
      salesRep,
      client,
    },
    documents: [],
  };
};

