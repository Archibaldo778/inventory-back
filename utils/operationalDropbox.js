import path from 'node:path';
import {
  findDropboxFolderEventMatch,
  inferDropboxEventFolderPath,
  inferDropboxPathDate,
} from './dropboxDocuments.js';

const clean = (value) => String(value || '').trim();
const safePart = (value, fallback = '') => clean(value)
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
  .replace(/\s+/g, ' ')
  .trim() || fallback;

export const joinOperationalDropboxPath = (...parts) => `/${parts
  .map((part) => clean(part).replace(/^\/+|\/+$/g, ''))
  .filter(Boolean)
  .join('/')}`;

export const dropboxFileBelongsToEvent = ({ filePath, fileName, event }) => {
  const match = findDropboxFolderEventMatch({
    path: filePath,
    name: fileName,
    inferredDate: inferDropboxPathDate(filePath),
  }, [{
    _id: event?._id || 'event',
    externalId: event?.externalId,
    title: event?.title,
    date: String(event?.date || '').slice(0, 10),
  }]);
  return match.status === 'matched';
};

export const resolveOperationalDropboxFolder = ({ event = {}, integration = {} } = {}) => {
  const sourceDocuments = [
    ...(Array.isArray(event.documents) ? event.documents : []),
    ...(Array.isArray(event.documentHistory) ? event.documentHistory : []),
  ];
  const existingPaths = sourceDocuments
    .filter((document) => clean(document?.sourceProvider).toLowerCase() === 'dropbox')
    .map((document) => clean(document?.sourcePath))
    .filter(Boolean);
  if (existingPaths.length) {
    const date = clean(event.date);
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateTokens = dateMatch ? [date, `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[1]}`, `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[1].slice(-2)}`] : [];
    const eventId = clean(event.externalId).toLowerCase();
    const candidateFolders = existingPaths.map((sourcePath) => {
      const parentParts = path.posix.dirname(sourcePath).split('/').filter(Boolean);
      const eventFolderIndex = parentParts.findIndex((part) => {
        const normalized = part.toLowerCase();
        return dateTokens.some((token) => normalized.includes(token.toLowerCase()))
          || (eventId && normalized.includes(eventId));
      });
      if (eventFolderIndex >= 0) return `/${parentParts.slice(0, eventFolderIndex + 1).join('/')}`;
      return inferDropboxEventFolderPath(sourcePath) || path.posix.dirname(sourcePath);
    });
    const uniqueFolders = [...new Set(candidateFolders.map((folder) => clean(folder).replace(/\/+$/g, '')).filter(Boolean))];
    // Never fall back to a shared parent (month/year/root). If attached source
    // documents disagree about their event folder, resolve the event afresh.
    if (uniqueFolders.length === 1) return { folderPath: uniqueFolders[0], existing: true };
  }

  const dateMatch = clean(event.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = dateMatch?.[1] || String(new Date().getUTCFullYear());
  const month = dateMatch
    ? new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
      .format(new Date(`${year}-${dateMatch[2]}-01T12:00:00Z`))
    : 'Unscheduled';
  const datePrefix = dateMatch ? `${dateMatch[2]}-${dateMatch[3]}-${year}` : 'Unscheduled';
  const configuredRoot = clean(integration.resolvedRootPath || integration.rootPath || '/Proposals');
  const yearRoot = configuredRoot.toLowerCase().endsWith(`/${year}`)
    ? configuredRoot
    : joinOperationalDropboxPath(configuredRoot, year);
  return {
    folderPath: joinOperationalDropboxPath(
      yearRoot,
      month,
      `${datePrefix} ${safePart(event.title, 'Untitled Event')}`
    ),
    existing: false,
  };
};
