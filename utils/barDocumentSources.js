import { inferDropboxPathDate, selectLatestDropboxFileRevisions } from './dropboxDocuments.js';

export const barDocumentExclusion = (document, event = {}) => {
  const name = String(document.fileName || '');
  if (/\bcopy\b|\(\d+\)(?=\.[^.]+$|\s)/i.test(name)) return 'File copy';
  const date = inferDropboxPathDate(name);
  const targetDate = String(event.date || event.eventDate || '').slice(0, 10);
  if (date && targetDate && date !== targetDate) return 'Different event date';
  const number = name.match(/(?:^|[^a-z0-9])(E\d+)(?=$|[^a-z0-9])/i)?.[1]?.toUpperCase();
  const targetNumber = String(event.externalId || event.eventNumber || '').match(/\bE\d+\b/i)?.[0]?.toUpperCase();
  if (number && targetNumber && number !== targetNumber) return 'Different event number';
  return '';
};
export const selectBarDocumentsForEvent = (documents = [], event = {}) => {
  const seen = new Set();
  return selectLatestDropboxFileRevisions(documents
    .filter((d) => ['po', 'kitchen_menu'].includes(d.type) && !barDocumentExclusion(d, event))
    .map((d) => ({ ...d, relativePath: d.fileName, modifiedAt: d.uploadedAt })))
    .filter((d) => { const key = d.checksum ? d.type + ':' + d.checksum : d.sourceId || d._id; if (!key) return true; if (seen.has(String(key))) return false; seen.add(String(key)); return true; });
};
