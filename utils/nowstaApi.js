import { fetchWithTimeout } from './fetchWithTimeout.js';

const NOWSTA_API_BASE_URL = 'https://api.nowsta.com/integrations';
const DEFAULT_PAST_DAYS = 60;
const DEFAULT_FUTURE_DAYS = 400;
const MAX_PAGES = 100;

const clean = (value, maxLength = 2_000) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
};

const shiftDate = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const resolveNowstaSyncRange = ({ now = new Date(), from, to } = {}) => {
  const pastDays = boundedInteger(process.env.NOWSTA_SYNC_PAST_DAYS, DEFAULT_PAST_DAYS, 0, 730);
  const futureDays = boundedInteger(process.env.NOWSTA_SYNC_FUTURE_DAYS, DEFAULT_FUTURE_DAYS, 1, 1_095);
  const start = from ? new Date(from) : shiftDate(now, -pastDays);
  const end = to ? new Date(to) : shiftDate(now, futureDays);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw Object.assign(new Error('Invalid Nowsta sync date range'), { statusCode: 400 });
  }
  return { from: start.toISOString(), to: end.toISOString() };
};

const parseRetrySeconds = (response) => {
  const raw = response?.headers?.get?.('retry-after');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : 1;
};

const wait = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
});

const safeUpstreamMessage = (status) => {
  if (status === 401 || status === 403) return 'Nowsta rejected the access key';
  if (status === 429) return 'Nowsta rate limit was reached';
  return `Nowsta API returned ${status || 'an invalid response'}`;
};

export const createNowstaClient = ({ apiKey = process.env.NOWSTA_API_KEY, fetchImpl = globalThis.fetch } = {}) => {
  const accessKey = clean(apiKey, 8_000);
  if (!accessKey) throw Object.assign(new Error('NOWSTA_API_KEY is not configured'), { statusCode: 503 });

  const request = async (pathname, params = {}, attempt = 0) => {
    const url = new URL(`${NOWSTA_API_BASE_URL}${pathname}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessKey}`,
      },
    }, { timeoutMs: 30_000, fetchImpl });
    if (response.status === 429 && attempt < 2) {
      await wait(parseRetrySeconds(response) * 1_000);
      return request(pathname, params, attempt + 1);
    }
    if (!response.ok) {
      throw Object.assign(new Error(safeUpstreamMessage(response.status)), {
        statusCode: [401, 403, 429].includes(response.status) ? response.status : 502,
      });
    }
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw Object.assign(new Error('Nowsta API returned an unsupported response'), { statusCode: 502 });
    }
    return response.json();
  };

  const listAll = async (pathname, params = {}) => {
    const objects = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await request(pathname, { ...params, page, per_page: 100 });
      const rows = Array.isArray(result?.objects) ? result.objects : [];
      objects.push(...rows);
      const totalPages = boundedInteger(result?.totalPages, page, 1, MAX_PAGES);
      if (page >= totalPages || rows.length === 0) break;
    }
    return objects;
  };

  return { request, listAll };
};

const zonedDate = (value, timeZone) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: clean(timeZone, 100) || 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const zonedTime = (value, timeZone) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: clean(timeZone, 100) || 'America/New_York',
      hour: 'numeric', minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const personName = (person) => clean([
  person?.first_name || person?.user_first_name,
  person?.last_name || person?.user_last_name,
].filter(Boolean).join(' '), 240) || clean(person?.nickname, 240) || clean(person?.email || person?.user_email, 240);

const eventAddress = (event) => clean([
  event?.address1,
  event?.address2,
  event?.city,
  event?.state,
  event?.zip,
].filter(Boolean).join(', '), 600);

const nowstaExternalId = (event) => {
  const primary = clean(event?.primary_external_id, 120);
  const secondary = clean(event?.external_id, 120);
  if (primary && secondary) {
    const normalizedPrimary = primary.toLowerCase().replace(/\s+/g, '');
    const normalizedSecondary = secondary.toLowerCase().replace(/\s+/g, '');
    if (normalizedSecondary.includes(normalizedPrimary)) return secondary;
    if (normalizedPrimary.includes(normalizedSecondary)) return primary;
    return `${primary} - ${secondary}`.slice(0, 120);
  }
  return primary || secondary || `nowsta:${String(event?.id ?? '')}`;
};

export const buildNowstaImportRows = ({ events = [], shifts = [], companyUsers = [] } = {}) => {
  const people = new Map(companyUsers.map((person) => [String(person?.id ?? ''), person]));
  const shiftsByEvent = new Map();
  shifts.forEach((shift) => {
    const eventId = String(shift?.event_id ?? '');
    if (!eventId) return;
    const workers = (Array.isArray(shift?.event_workers) ? shift.event_workers : [])
      .filter((worker) => !worker?.removed_at)
      .map((worker) => {
        const person = people.get(String(worker?.company_user_id ?? ''));
        const name = personName(person);
        if (!name) return null;
        return {
          name,
          status: clean(worker?.status, 40).toLowerCase(),
          agency: Boolean(person?.staffing_agency_placeholder),
        };
      })
      .filter(Boolean);
    const normalized = {
      position: clean(shift?.position_name || shift?.name, 160),
      startTime: zonedTime(shift?.starts_at, shift?.time_zone),
      endTime: zonedTime(shift?.ends_at, shift?.time_zone),
      workers,
      unfilled: Math.max(0, Number(shift?.open_count) || Math.max(0, (Number(shift?.quantity) || 0) - workers.length)),
    };
    if (!normalized.position) return;
    const list = shiftsByEvent.get(eventId) || [];
    list.push(normalized);
    shiftsByEvent.set(eventId, list);
  });

  return events
    .filter((event) => event && !event.archived_at && clean(event.name, 300))
    .map((event) => {
      const apiEventId = String(event.id ?? '');
      const eventShifts = shiftsByEvent.get(apiEventId) || [];
      const externalId = nowstaExternalId(event);
      const venue = clean(event.venue_name, 300);
      const address = eventAddress(event);
      const eventTime = [
        zonedTime(event.occurs_at, event.time_zone),
        zonedTime(event.ends_at, event.time_zone),
      ].filter(Boolean).join(' – ');
      const assigned = eventShifts.reduce((total, shift) => total + shift.workers.length, 0);
      const unfilled = eventShifts.reduce((total, shift) => total + shift.unfilled, 0);
      return {
        externalId,
        title: clean(event.name, 300),
        date: zonedDate(event.occurs_at, event.time_zone),
        client: clean(event.client_name, 300),
        managerId: '',
        status: 'draft',
        importSource: 'nowsta',
        meta: {
          guestCount: Number.isFinite(Number(event.number_of_guests)) ? Number(event.number_of_guests) : null,
          venue,
          address,
          eventTime,
          nowsta: {
            apiEventId,
            companyId: String(event.company_id ?? ''),
            department: String(event.department_id ?? ''),
            venue,
            address,
            eventTime,
            uniform: '',
            adminNotes: clean(event.admin_notes || event.supervisor_notes, 2_000),
            staffTotals: `${assigned} assigned · ${unfilled} unfilled`,
            updatedAt: clean(event.updated_at, 100),
            shifts: eventShifts,
          },
        },
      };
    })
    .filter((event) => event.date && event.externalId);
};

export const fetchNowstaImportRows = async ({ from, to, fetchImpl, apiKey } = {}) => {
  const range = resolveNowstaSyncRange({ from, to });
  const client = createNowstaClient({ fetchImpl, apiKey });
  const [events, shifts, companyUsers] = await Promise.all([
    client.listAll('/v2/events', { starts_after: range.from, starts_before: range.to }),
    client.listAll('/v2/shifts', {
      starts_at: range.from,
      ends_at: range.to,
      include_event_workers: true,
      include_removed_event_workers: false,
    }),
    client.listAll('/v2/company_users', { include_archived: false }),
  ]);
  return {
    range,
    counts: { events: events.length, shifts: shifts.length, companyUsers: companyUsers.length },
    events: buildNowstaImportRows({ events, shifts, companyUsers }),
  };
};
