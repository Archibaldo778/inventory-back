import { inferDropboxDocumentType } from './dropboxDocuments.js';

const clean = (value) => String(value || '').trim();

export const normalizeCatereaseEventId = (value) => {
  const match = clean(value).toUpperCase().match(/\bE\s*[-_ ]?\s*(\d{2,})\b/);
  return match ? `E${match[1]}` : '';
};

export const classifyCatereaseFile = (file = {}) => inferDropboxDocumentType(
  `${clean(file.FileName || file.fileName)} ${clean(file.Comment || file.comment)}`
);

export const normalizeCatereaseFile = (file = {}, eventId = '') => {
  const uid = Number(file.UID ?? file.uid);
  const revised = clean(file.Revised ?? file.revisedAt);
  return {
    uid,
    catereaseEventId: normalizeCatereaseEventId(eventId),
    fileName: clean(file.FileName ?? file.fileName),
    comment: clean(file.Comment ?? file.comment),
    booked: Boolean(file.Booked ?? file.booked),
    shared: Boolean(file.Shared ?? file.shared),
    sortOrder: Number(file.SortOrder ?? file.sortOrder) || 0,
    revisedAt: revised && !Number.isNaN(new Date(revised).getTime()) ? new Date(revised) : null,
    documentType: classifyCatereaseFile(file),
  };
};

export const catereaseFileRevision = (file = {}) => {
  const revised = file?.revisedAt ? new Date(file.revisedAt).toISOString() : '';
  return revised || String(file?.etag || '').trim() || `uid:${Number(file?.uid) || 0}`;
};

