const clean = (value) => String(value || '').trim();

export const nyToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

export const inferDropboxDocumentType = (name) => {
  const normalized = clean(name).replace(/[_-]+/g, ' ');
  const kitchen = /\b(?:kitchen\s*menu|km)\b/i.test(normalized);
  const po = /\b(?:purchase\s*order|pack\s*out|packout|po)\b/i.test(normalized);
  if (kitchen && !po) return 'kitchen_menu';
  if (po && !kitchen) return 'po';
  return 'review';
};

export const inferDropboxEventId = (value) => {
  const source = clean(value).toUpperCase();
  const primary = source.match(/\bE\s*[-_ ]?\s*(\d{2,})\b/);
  if (!primary) return '';
  return `E${primary[1]}`;
};

export const inferDropboxRevision = (value) => {
  const source = clean(value);
  const matches = [...source.matchAll(/\b(?:revision|rev(?:ision)?|version|ver)\s*[-_.#:]?\s*(\d{1,4})\b/gi)];
  const shortMatches = [...source.matchAll(/(?:^|[\s._-])v\s*[-_.#:]?\s*(\d{1,4})(?=$|[\s._-])/gi)];
  const match = matches.at(-1) || shortMatches.at(-1);
  if (!match) return { number: null, label: '' };
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? { number, label: `Revision ${number}` } : { number: null, label: '' };
};

export const inferDropboxDocumentSeries = (value) => clean(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\.docx\b/g, '')
  .replace(/\b(?:revision|rev(?:ision)?|version|ver)\s*[-_.#:]?\s*\d{1,4}\b/g, ' ')
  .replace(/(?:^|[\s._-])v\s*[-_.#:]?\s*\d{1,4}(?=$|[\s._-])/g, ' ')
  .replace(/\bE\s*[-_ ]?\s*\d{2,}(?:\s*[-_ ]\s*S\s*[-_ ]?\s*\d{2,})?\b/gi, ' event ')
  .replace(/\b20\d{2}[-_.\/]\d{1,2}[-_.\/]\d{1,2}\b/g, ' date ')
  .replace(/\b\d{1,2}[-_.]\d{1,2}[-_.](?:20\d{2}|\d{2})\b/g, ' date ')
  .replace(/\b(?:kitchen\s*menu|km|purchase\s*order|pack\s*out|packout|po)\b/g, ' document ')
  .split('/')
  .map((segment) => segment.replace(/[^a-z0-9]+/g, ' ').trim())
  .filter(Boolean)
  .join('/');

export const inferDropboxEventTitle = (value) => clean(value)
  .replace(/\.[^.]+$/, '')
  .replace(/\b20\d{2}[-_.\/]\d{1,2}[-_.\/]\d{1,2}\b/g, ' ')
  .replace(/\b\d{1,2}[-_.]\d{1,2}[-_.](?:20\d{2}|\d{2})\b/g, ' ')
  .replace(/\bE\s*[-_ ]?\s*\d{2,}(?:\s*[-_ ]\s*S\s*[-_ ]?\s*\d{2,})?\b/gi, ' ')
  .replace(/\b(?:revision|rev(?:ision)?|version|ver)\s*[-_.#:]?\s*\d{1,4}\b/gi, ' ')
  .replace(/(?:^|[\s._-])v\s*[-_.#:]?\s*\d{1,4}(?=$|[\s._-])/gi, ' ')
  .replace(/\b(?:kitchen\s*menu|km|purchase\s*order|pack\s*out|packout|po)\b/gi, ' ')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\s+(?:beverage|staff\s+holding|vendor\s+meal|dinner\s+kitchen|hds\s+(?:and|&)\s+station)\s*$/i, '')
  .trim();

const normalizedEventName = (value) => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizedEventNumber = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const baseEventNumber = (value) => normalizedEventNumber(value).match(/^E\d+/)?.[0] || normalizedEventNumber(value);

const GENERIC_PATH_SEGMENTS = new Set([
  'proposals',
  'proposal',
  'leadership file',
  'leadership files',
  'documents',
  'files',
  'po',
  'purchase order',
  'purchase orders',
  'km',
  'kitchen menu',
  'kitchen menus',
]);

export const inferDropboxEventTitles = (document = {}) => {
  const path = clean(document?.path || document?.path_display || document?.path_lower);
  const name = clean(document?.name) || path.split('/').filter(Boolean).at(-1) || '';
  const candidates = [document?.contentEventTitle, name, ...path.split('/').filter(Boolean).slice(0, -1).reverse()];
  const seen = new Set();
  return candidates.map((candidate) => inferDropboxEventTitle(candidate))
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
    .filter((candidate) => {
      const normalized = normalizedEventName(candidate);
      if (!normalized || normalized.length < 4 || seen.has(normalized)) return false;
      if (GENERIC_PATH_SEGMENTS.has(normalized)) return false;
      if (/^(?:20\d{2}|\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december)$/.test(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

export const findDropboxEventMatch = (document, events = []) => {
  const candidates = (Array.isArray(events) ? events : []).filter((event) => event?._id || event?.id);
  const eventId = normalizedEventNumber(document?.eventId);
  if (eventId) {
    const numbered = candidates.filter((event) => {
      const candidate = normalizedEventNumber(event?.externalId || event?.eventId);
      return candidate && (candidate === eventId || baseEventNumber(candidate) === baseEventNumber(eventId));
    });
    if (numbered.length === 1) return { status: 'matched', event: numbered[0], reason: 'event_id' };
    if (numbered.length > 1) return { status: 'ambiguous', events: numbered, reason: 'event_id' };
  }

  const date = clean(document?.inferredDate);
  const titles = inferDropboxEventTitles(document).map(normalizedEventName).filter(Boolean);
  const dated = candidates.filter((event) => clean(event?.date).slice(0, 10) === date);
  const exact = dated.filter((event) => titles.includes(normalizedEventName(event?.title || event?.name)));
  if (titles.length && exact.length === 1) return { status: 'matched', event: exact[0], reason: 'name_date' };
  const similar = dated.filter((event) => {
    const candidate = normalizedEventName(event?.title || event?.name);
    return candidate && titles.some((title) => title.length >= 6 && (candidate.includes(title) || title.includes(candidate)));
  });
  if (similar.length === 1) return { status: 'matched', event: similar[0], reason: 'similar_name_date' };
  return {
    status: exact.length > 1 || similar.length > 1 ? 'ambiguous' : 'unmatched',
    events: exact.length ? exact : similar,
    reason: 'name_date',
  };
};

export const getDropboxRevisionMetadata = (entry) => {
  const path = clean(entry?.path_display || entry?.path || entry?.path_lower);
  const name = clean(entry?.name);
  const documentType = entry?.documentType || inferDropboxDocumentType(`${path}/${name}`);
  const inferredDate = entry?.inferredDate || inferDropboxPathDate(path);
  const eventId = clean(entry?.eventId || entry?.contentEventId) || inferDropboxEventId(`${path}/${name}`);
  const revision = inferDropboxRevision(`${path}/${name}`);
  const revisionSeries = inferDropboxDocumentSeries(path || name);
  return {
    eventId,
    revisionNumber: revision.number,
    revisionLabel: revision.label,
    revisionSeries,
    revisionGroupKey: inferredDate && documentType !== 'review'
      ? `${eventId || 'no-event-id'}|${inferredDate}|${documentType}|${revisionSeries}`
      : '',
  };
};

const documentTimestamp = (document) => {
  const value = document?.serverModifiedAt || document?.clientModifiedAt || document?.lastSeenAt || document?.createdAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const buildDropboxRevisionPlan = (documents) => {
  const rows = (Array.isArray(documents) ? documents : []).map((document) => ({
    document,
    ...getDropboxRevisionMetadata(document),
  }));
  const groups = new Map();
  rows.forEach((row) => {
    if (!row.revisionGroupKey) return;
    const group = groups.get(row.revisionGroupKey) || [];
    group.push(row);
    groups.set(row.revisionGroupKey, group);
  });
  const plan = [];
  rows.forEach((row) => {
    const base = {
      dropboxId: clean(row.document?.dropboxId),
      eventId: row.eventId,
      revisionNumber: row.revisionNumber,
      revisionLabel: row.revisionLabel,
      revisionSeries: row.revisionSeries,
      revisionGroupKey: row.revisionGroupKey,
      isLatestRevision: false,
      supersededByDropboxId: '',
    };
    if (!row.revisionGroupKey) {
      plan.push(base);
      return;
    }
    const group = groups.get(row.revisionGroupKey) || [];
    if (group.length === 1) {
      plan.push({ ...base, isLatestRevision: true });
      return;
    }
    const numbered = group.filter((candidate) => candidate.revisionNumber !== null);
    if (!numbered.length) {
      plan.push({ ...base, status: 'review', reason: 'Multiple files exist for this event and document type, but no revision number could be confirmed' });
      return;
    }
    const latest = [...numbered].sort((a, b) => (
      b.revisionNumber - a.revisionNumber
      || documentTimestamp(b.document) - documentTimestamp(a.document)
      || clean(b.document?.dropboxId).localeCompare(clean(a.document?.dropboxId))
    ))[0];
    if (row.revisionNumber === null) {
      plan.push({ ...base, status: 'review', reason: `Revision number is missing; ${latest.revisionLabel} exists for this event` });
      return;
    }
    if (clean(row.document?.dropboxId) === clean(latest.document?.dropboxId)) {
      plan.push({ ...base, isLatestRevision: true });
      return;
    }
    plan.push({
      ...base,
      status: 'superseded',
      reason: `Superseded by ${latest.revisionLabel}`,
      supersededByDropboxId: clean(latest.document?.dropboxId),
    });
  });
  return plan;
};

export const inferDropboxPathDate = (path) => {
  const source = clean(path);
  const matches = [
    ...[...source.matchAll(/\b(20\d{2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})\b/g)].map((match) => ({
      index: match.index,
      value: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`,
    })),
    ...[...source.matchAll(/\b(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}|\d{2})\b/g)].map((match) => ({
      index: match.index,
      value: `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`,
    })),
  ].sort((left, right) => right.index - left.index);
  if (matches.length) return matches[0].value;
  return '';
};

const inferYearMonth = (path) => {
  const parts = clean(path).split('/').filter(Boolean);
  let year = '';
  let month = '';
  for (const part of parts) {
    const yearMatch = part.match(/\b(20\d{2})\b/);
    if (yearMatch) year = yearMatch[1];
    const numericMonth = part.match(/^(?:0?[1-9]|1[0-2])(?:\b|\s|[-_])/);
    if (numericMonth) month = numericMonth[0].match(/\d+/)[0].padStart(2, '0');
    const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const nameIndex = names.findIndex((name) => part.toLowerCase().includes(name));
    if (nameIndex >= 0) month = String(nameIndex + 1).padStart(2, '0');
  }
  return year && month ? `${year}-${month}` : (year ? `${year}` : '');
};

export const classifyDropboxEntry = (entry, { today = nyToday() } = {}) => {
  const tag = clean(entry?.['.tag']);
  const path = clean(entry?.path_display || entry?.path_lower);
  const name = clean(entry?.name);
  if (tag === 'deleted') return { status: 'deleted', reason: 'Removed from Dropbox', inferredDate: '', documentType: 'review' };
  if (tag !== 'file' || !/\.docx$/i.test(name) || /^~\$/i.test(name)) {
    return { status: 'ignored', reason: 'Not a DOCX PO/Kitchen Menu', inferredDate: '', documentType: 'review' };
  }
  const inferredDate = inferDropboxPathDate(path);
  const folderDatePrefix = inferYearMonth(path);
  const todayMonth = today.slice(0, 7);
  if (
    (inferredDate && inferredDate < today)
    || (folderDatePrefix.length === 7 && folderDatePrefix < todayMonth)
    || (folderDatePrefix.length === 4 && folderDatePrefix < today.slice(0, 4))
  ) {
    return { status: 'skipped_old', reason: 'Before the current New York date', inferredDate, documentType: inferDropboxDocumentType(name) };
  }
  const documentType = inferDropboxDocumentType(`${path}/${name}`);
  if (!inferredDate && !folderDatePrefix) {
    return { status: 'ignored', reason: 'Outside the dated Caterease folder structure', inferredDate: '', documentType };
  }
  if (!inferredDate) return { status: 'review', reason: 'Event date could not be confirmed from the path or filename', inferredDate: '', documentType };
  if (documentType === 'review') return { status: 'review', reason: 'Document type could not be confirmed from the filename', inferredDate, documentType };
  const revision = getDropboxRevisionMetadata({ ...entry, documentType, inferredDate });
  return { status: 'discovered', reason: 'Ready for safe matching', inferredDate, documentType, ...revision };
};
