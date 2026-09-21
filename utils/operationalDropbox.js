import path from 'node:path';

const clean = (value) => String(value || '').trim();
const safePart = (value, fallback = '') => clean(value)
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
  .replace(/\s+/g, ' ')
  .trim() || fallback;

export const joinOperationalDropboxPath = (...parts) => `/${parts
  .map((part) => clean(part).replace(/^\/+|\/+$/g, ''))
  .filter(Boolean)
  .join('/')}`;

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
    const firstParts = existingPaths[0].split('/').filter(Boolean);
    const date = clean(event.date);
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateTokens = dateMatch ? [date, `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[1]}`, `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[1].slice(-2)}`] : [];
    const eventId = clean(event.externalId).toLowerCase();
    const eventFolderIndex = firstParts.findIndex((part) => {
      const normalized = part.toLowerCase();
      return dateTokens.some((token) => normalized.includes(token.toLowerCase()))
        || (eventId && normalized.includes(eventId));
    });
    if (eventFolderIndex >= 0) {
      return { folderPath: `/${firstParts.slice(0, eventFolderIndex + 1).join('/')}`, existing: true };
    }
    const parentParts = existingPaths.map((sourcePath) => path.posix.dirname(sourcePath).split('/').filter(Boolean));
    const commonParts = firstParts.filter((_part, index) => parentParts.every((parts) => parts[index] === firstParts[index]));
    return {
      folderPath: commonParts.length ? `/${commonParts.join('/')}` : path.posix.dirname(existingPaths[0]),
      existing: true,
    };
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
