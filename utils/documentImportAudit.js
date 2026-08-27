const plain = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(source));
};

export const snapshotEventDocuments = (documents = []) => (
  (Array.isArray(documents) ? documents : []).map(plain).filter(Boolean)
);

const documentIdentity = (document) => [
  String(document?._id || ''),
  String(document?.type || ''),
  String(document?.checksum || ''),
  String(document?.url || ''),
  Number(document?.version) || 0,
].join('|');

export const eventDocumentsMatchSnapshot = (documents = [], snapshot = []) => {
  const current = snapshotEventDocuments(documents).map(documentIdentity).sort();
  const expected = snapshotEventDocuments(snapshot).map(documentIdentity).sort();
  return JSON.stringify(current) === JSON.stringify(expected);
};

export const nextEventDocumentVersion = (type, current = [], history = []) => {
  const versions = [...(Array.isArray(current) ? current : []), ...(Array.isArray(history) ? history : [])]
    .filter((document) => String(document?.type || '') === String(type || ''))
    .map((document) => Number(document?.version) || 0);
  return Math.max(0, ...versions) + 1;
};

export const mergeEventDocumentHistory = (...groups) => {
  const byIdentity = new Map();
  groups.flat().filter(Boolean).forEach((document) => {
    const value = plain(document);
    const identity = String(value?._id || '') || documentIdentity(value);
    if (!byIdentity.has(identity)) byIdentity.set(identity, value);
  });
  return [...byIdentity.values()]
    .sort((left, right) => new Date(right?.uploadedAt || 0) - new Date(left?.uploadedAt || 0))
    .slice(0, 100);
};

const BAR_IMPORT_FIELDS = Object.freeze([
  'eventNumber',
  'guestCount',
  'guestCountSource',
  'items',
  'packout',
  'status',
  'revision',
]);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

export const snapshotBarDocumentImport = (event) => {
  const source = plain(event) || {};
  return Object.fromEntries(BAR_IMPORT_FIELDS.map((field) => [field, source[field]]));
};

export const barDocumentImportMatchesSnapshot = (event, snapshot) => {
  if (!event || !snapshot) return false;
  const current = snapshotBarDocumentImport(event);
  return JSON.stringify(stableValue(current)) === JSON.stringify(stableValue(snapshot));
};

export const applyBarDocumentImportSnapshot = (event, snapshot) => {
  if (!event || !snapshot) return event;
  BAR_IMPORT_FIELDS.forEach((field) => {
    event[field] = plain(snapshot[field]);
  });
  return event;
};
