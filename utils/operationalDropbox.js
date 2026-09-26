import path from 'node:path';
import {
  inferDropboxEventFolderPath,
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

const MONTH_FOLDER_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

export const isUnsafeOperationalDropboxFolder = (folderPath, integration = {}) => {
  const normalized = clean(folderPath).replace(/\/+$/g, '');
  if (!normalized || normalized === '/') return true;
  const configuredRoot = clean(integration.resolvedRootPath || integration.rootPath || '/Proposals').replace(/\/+$/g, '');
  if (configuredRoot && normalized.toLowerCase() === configuredRoot.toLowerCase()) return true;
  const basename = path.posix.basename(normalized).toLowerCase();
  return /^20\d{2}$/.test(basename)
    || /^(?:0?[1-9]|1[0-2])$/.test(basename)
    || MONTH_FOLDER_NAMES.has(basename);
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
