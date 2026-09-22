import { inferDropboxRevision } from './dropboxDocuments.js';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const STAFF_REQUEST_FILE_PATTERN = /(?:\bstaff(?:ing)?\s*(?:request|req)(?:\s*form)?\b|\bsr\b)/i;
export const RENTAL_FILE_PATTERN = /(?:^|[^a-z0-9])(?:prl|rental(?:s|\s*order)?)(?=$|[^a-z0-9])/i;
export const RENTAL_FOLDER_PATTERN = /[\\/]rentals?[\\/]/i;

const excludedRentalFile = (value) => /\b(?:rental\s*notes?|notes?\s*rentals?|rental\s*samples?|samples?\s*rentals?)\b/i.test(value);

export const inferOperationalStatusType = (value) => {
  const name = clean(value).replace(/[\\/_-]+/g, ' ');
  if (/\b(?:staff(?:ing)?\s*(?:request|req)(?:\s*form)?|sr)\b/i.test(name)) return 'sr';
  if (/\b(?:annotated\s*kitchen\s*menu|kitchen\s*menu|akm|km)\b/i.test(name)) return 'km';
  if (/\b(?:kitchen\s*pack\s*out|purchase\s*order|pack\s*out|kpo|po)\b/i.test(name)) return 'po';
  if (!excludedRentalFile(name) && (RENTAL_FILE_PATTERN.test(name) || RENTAL_FOLDER_PATTERN.test(value))) return 'rental';
  return '';
};

const modifiedAt = (file) => {
  const value = file?.modifiedAt || file?.serverModifiedAt || file?.clientModifiedAt || file?.lastSeenAt || file?.updatedAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const documentRevision = (file) => {
  const stored = Number(file?.revisionNumber);
  if (Number.isSafeInteger(stored) && stored > 0) return stored;
  return inferDropboxRevision(clean(file?.relativePath || file?.path || file?.name)).number;
};

const latestStatus = (files) => {
  const rows = (Array.isArray(files) ? files : []).map((file) => ({
    file,
    revision: documentRevision(file),
    timestamp: modifiedAt(file),
  })).sort((left, right) => (
    (right.revision ?? -1) - (left.revision ?? -1)
    || right.timestamp - left.timestamp
    || clean(right.file?.name).localeCompare(clean(left.file?.name))
  ));
  const latest = rows[0];
  if (!latest) return { value: '', available: false, revision: null, updatedAt: null, fileName: '' };
  return {
    value: latest.revision ? `Rev${latest.revision}` : 'Yes',
    available: true,
    revision: latest.revision,
    updatedAt: latest.timestamp ? new Date(latest.timestamp).toISOString() : null,
    fileName: clean(latest.file?.relativePath || latest.file?.path || latest.file?.name),
  };
};

export const isOperationalDocumentsNotApplicable = (event = {}) => /\b(?:staff\s*only|load[\s-]*in|load[\s-]*out|rental[\s-]*check[\s-]*in)\b/i.test([
  event?.Category,
  event?.category,
  event?.PartyName,
  event?.title,
].map(clean).filter(Boolean).join(' '));

export const isStaffRequestNotApplicable = isOperationalDocumentsNotApplicable;

export const buildOperationalDocumentStatus = (files, {
  operationalDocumentsNotApplicable = false,
  staffRequestNotApplicable = false,
} = {}) => {
  const grouped = { sr: [], km: [], po: [], rental: [] };
  (Array.isArray(files) ? files : []).forEach((file) => {
    const identity = clean(file?.relativePath || file?.path || file?.name);
    const fileName = identity.replace(/\\/g, '/').split('/').at(-1) || '';
    if (!/\.[a-z0-9]{2,5}$/i.test(fileName)) return;
    const type = inferOperationalStatusType(identity);
    if (type) grouped[type].push(file);
  });
  const status = {
    sr: latestStatus(grouped.sr),
    km: latestStatus(grouped.km),
    po: latestStatus(grouped.po),
    rental: latestStatus(grouped.rental),
  };
  const defaultOperationalDocumentsToNotApplicable = operationalDocumentsNotApplicable || staffRequestNotApplicable;
  if (defaultOperationalDocumentsToNotApplicable) {
    ['sr', 'km', 'po'].forEach((type) => {
      if (!status[type].available) status[type] = { ...status[type], value: 'N/A', notApplicable: true };
    });
  }
  return status;
};
