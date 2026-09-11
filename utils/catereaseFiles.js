import {
  inferDropboxDocumentSeries,
  inferDropboxDocumentType,
} from './dropboxDocuments.js';

const clean = (value) => String(value || '').trim();

export const normalizeCatereaseEventId = (value) => {
  const match = clean(value).toUpperCase().match(/\bE\s*[-_ ]?\s*(\d{2,})\b/);
  return match ? `E${match[1]}` : '';
};

export const normalizeCatereaseRawEventId = (value) => {
  const normalized = normalizeCatereaseEventId(value);
  if (normalized) return normalized;
  const numeric = clean(value).match(/^0*(\d{2,})$/)?.[1];
  return numeric ? `E${numeric}` : '';
};

export const catereaseEventIdCandidates = (value) => {
  const normalized = normalizeCatereaseEventId(value);
  if (!normalized) return [];
  return [normalized, normalized.slice(1)];
};

export const classifyCatereaseFile = (file = {}) => inferDropboxDocumentType(
  `${clean(file.FileName || file.fileName)} ${clean(file.Comment || file.comment)}`
);

export const catereaseFileSeries = (file = {}, eventId = '') => {
  const documentType = file.documentType || classifyCatereaseFile(file);
  if (documentType === 'review') return '';
  const normalizedEventId = normalizeCatereaseEventId(eventId || file.catereaseEventId) || 'no-event-id';
  const sourceName = clean(file.fileName || file.FileName).replace(/\.[^.]+$/, '');
  const sourceComment = clean(file.comment || file.Comment);
  const normalizeSeriesPart = (value) => inferDropboxDocumentSeries(value)
    .replace(/\b(?:latest|current|final|copy|updated|new)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rawNormalizedName = normalizeSeriesPart(sourceName);
  const normalizedName = /^(?:document|event document)$/.test(rawNormalizedName) ? '' : rawNormalizedName;
  const rawNormalizedComment = normalizeSeriesPart(sourceComment);
  const normalizedComment = /^(?:document|event document)$/.test(rawNormalizedComment) ? '' : rawNormalizedComment;
  const series = normalizedName || normalizedComment || 'default';
  return `caterease:${normalizedEventId}:${documentType}:${series}`;
};

const fileTimestamp = (file) => {
  const timestamp = new Date(file?.revisedAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const selectLatestCatereaseFiles = (files = [], eventId = '') => {
  const groups = new Map();
  (Array.isArray(files) ? files : []).forEach((file) => {
    const sourceSeries = catereaseFileSeries(file, eventId);
    if (!sourceSeries) return;
    const group = groups.get(sourceSeries) || [];
    group.push({ ...file, sourceSeries });
    groups.set(sourceSeries, group);
  });
  const latest = [];
  const superseded = [];
  groups.forEach((group) => {
    group.sort((left, right) => (
      fileTimestamp(right) - fileTimestamp(left)
      || Number(right.sortOrder || 0) - Number(left.sortOrder || 0)
      || Number(right.uid || 0) - Number(left.uid || 0)
    ));
    const [winner, ...older] = group;
    latest.push({ ...winner, seriesUids: group.map((file) => Number(file.uid)).filter(Number.isSafeInteger) });
    older.forEach((file) => superseded.push({ ...file, supersededByUid: winner.uid }));
  });
  return { latest, superseded };
};

export const normalizeCatereaseFile = (file = {}, eventId = '') => {
  const uid = Number(file.UID ?? file.uid);
  const revised = clean(file.Revised ?? file.revisedAt);
  const normalized = {
    uid,
    catereaseEventId: normalizeCatereaseRawEventId(eventId || file.EvtNum || file.evtNum),
    fileName: clean(file.FileName ?? file.fileName),
    comment: clean(file.Comment ?? file.comment),
    booked: Boolean(file.Booked ?? file.booked),
    shared: Boolean(file.Shared ?? file.shared),
    sortOrder: Number(file.NSort ?? file.nSort ?? file.SortOrder ?? file.sortOrder) || 0,
    revisedAt: revised && !Number.isNaN(new Date(revised).getTime()) ? new Date(revised) : null,
    documentType: classifyCatereaseFile(file),
  };
  return { ...normalized, sourceSeries: catereaseFileSeries(normalized, eventId) };
};

export const catereaseFileRevision = (file = {}) => {
  const revised = file?.revisedAt ? new Date(file.revisedAt).toISOString() : '';
  return revised || String(file?.etag || '').trim() || `uid:${Number(file?.uid) || 0}`;
};
