import { inferDropboxRevision } from './dropboxDocuments.js';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const inferOperationalStatusType = (value) => {
  const name = clean(value).replace(/[\\/_-]+/g, ' ');
  if (/\b(?:staff(?:ing)?\s*(?:request|req)(?:\s*form)?|sr)\b/i.test(name)) return 'sr';
  if (/\b(?:annotated\s*kitchen\s*menu|kitchen\s*menu|akm|km)\b/i.test(name)) return 'km';
  if (/\b(?:kitchen\s*pack\s*out|purchase\s*order|pack\s*out|kpo|po)\b/i.test(name)) return 'po';
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

export const isStaffRequestNotApplicable = (event = {}) => /\b(?:staff\s*only|load[\s-]*in|load[\s-]*out)\b/i.test([
  event?.Category,
  event?.category,
  event?.PartyName,
  event?.title,
].map(clean).filter(Boolean).join(' '));

export const buildOperationalDocumentStatus = (files, { staffRequestNotApplicable = false } = {}) => {
  const grouped = { sr: [], km: [], po: [] };
  (Array.isArray(files) ? files : []).forEach((file) => {
    const type = inferOperationalStatusType(file?.relativePath || file?.path || file?.name);
    if (type) grouped[type].push(file);
  });
  const status = {
    sr: latestStatus(grouped.sr),
    km: latestStatus(grouped.km),
    po: latestStatus(grouped.po),
  };
  if (!status.sr.available && staffRequestNotApplicable) status.sr = { ...status.sr, value: 'N/A', notApplicable: true };
  return status;
};
