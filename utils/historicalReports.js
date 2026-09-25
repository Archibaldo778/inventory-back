const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const HISTORICAL_REPORT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'txt', 'rtf',
]);

export const historicalReportExtension = (value) => (
  clean(value).match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase() || ''
);

const validDate = (year, month, day) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export const inferHistoricalReportDate = (value) => {
  const source = clean(value);
  const ymd = source.match(/(?:^|[^0-9])(20\d{2})[-_. /](\d{1,2})[-_. /](\d{1,2})(?=$|[^0-9])/);
  if (ymd) return validDate(ymd[1], ymd[2], ymd[3]);
  const mdy = source.match(/(?:^|[^0-9])(\d{1,2})[-_. /](\d{1,2})[-_. /](20\d{2}|\d{2})(?=$|[^0-9])/);
  if (!mdy) return '';
  const year = mdy[3].length === 2 ? Number(mdy[3]) + 2000 : Number(mdy[3]);
  return validDate(year, mdy[1], mdy[2]);
};

const normalizeTitle = (value) => clean(value)
  .replace(/\.[a-z0-9]{2,6}$/i, '')
  .replace(/(?:^|\s)(?:20\d{2}|\d{1,2})[-_. /](?:\d{1,2})[-_. /](?:20\d{2}|\d{2})(?=\s|$)/g, ' ')
  .replace(/\b(?:event\s+evaluation\s+form|evaluation\s+form|captain'?s?\s+report|kitchen\s+report|event\s+report|report)\b/gi, ' ')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const ignoredFolder = (value) => /^(?:reports?|archive|historical|captain|kitchen|20\d{2}|\d{1,2}\s+[a-z]+)$/i.test(clean(value));

export const inferHistoricalReportTitle = (path, rootPath = '') => {
  const normalizedPath = String(path || '').replace(/\\/g, '/');
  const relative = rootPath && normalizedPath.toLowerCase().startsWith(String(rootPath).toLowerCase())
    ? normalizedPath.slice(String(rootPath).length)
    : normalizedPath;
  const parts = relative.split('/').filter(Boolean);
  const fileTitle = normalizeTitle(parts.at(-1) || '');
  if (fileTitle.length >= 4 && !/^\d+$/.test(fileTitle)) return fileTitle.slice(0, 300);
  const folder = parts.slice(0, -1).reverse().find((part) => !ignoredFolder(part));
  return normalizeTitle(folder || '').slice(0, 300);
};

export const inferHistoricalReportType = (value) => {
  const source = clean(value);
  if (/\b(?:kitchen|lead\s*chef|chef)\b/i.test(source)) return 'kitchen';
  if (/\b(?:captain|event\s*evaluation|service)\b/i.test(source)) return 'captain';
  return 'unknown';
};

export const normalizedHistoricalEventTitle = (value) => clean(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(?:the|an|a|event|party)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const historicalReportMetadata = (entry = {}, rootPath = '') => {
  const path = clean(entry?.path_display || entry?.path_lower || entry?.path);
  const name = clean(entry?.name || path.split('/').at(-1));
  const extension = historicalReportExtension(name);
  const inferredDate = inferHistoricalReportDate(path);
  const pathYear = path.match(/(?:^|\/)(20\d{2})(?=\/|\s|$)/)?.[1];
  return {
    path,
    name,
    extension,
    inferredDate,
    inferredYear: Number(inferredDate.slice(0, 4) || pathYear) || null,
    inferredTitle: inferHistoricalReportTitle(path, rootPath),
    reportType: inferHistoricalReportType(path),
    supported: HISTORICAL_REPORT_EXTENSIONS.has(extension),
  };
};
