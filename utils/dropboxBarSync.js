import crypto from 'node:crypto';
import { selectLatestDropboxFileRevisions } from './dropboxDocuments.js';
import { selectBarPackoutSeries } from './barSeriesCharges.js';

export const selectDropboxBarSourceDocuments = (documents = []) => selectLatestDropboxFileRevisions(
  (Array.isArray(documents) ? documents : [])
    .filter((document) => String(document?.sourceProvider || '') === 'dropbox')
    .map((document) => {
      const source = typeof document?.toObject === 'function' ? document.toObject() : { ...document };
      return {
        ...source,
        relativePath: String(source?.sourcePath || source?.fileName || ''),
        modifiedAt: source?.uploadedAt,
      };
    }),
);

export const resolveDropboxSharedSeriesDocuments = (events = [], currentEventId = '') => {
  const rows = (Array.isArray(events) ? events : []).map((event) => ({
    ...event,
    _id: String(event?._id || ''),
    name: String(event?.name || event?.title || ''),
    eventDate: String(event?.eventDate || event?.date || ''),
    externalId: String(event?.externalId || event?.eventNumber || ''),
  }));
  const current = rows.find((event) => event._id === String(currentEventId || ''));
  if (!current) return null;
  const namedSeries = selectBarPackoutSeries(rows, current);
  const baseEventNumber = current.externalId.match(/\bE\d+\b/i)?.[0]?.toUpperCase() || '';
  const numberedSeries = baseEventNumber
    ? rows.filter((event) => (
      event.externalId.match(/\bE\d+\b/i)?.[0]?.toUpperCase() === baseEventNumber
    ))
      .sort((left, right) => left.eventDate.localeCompare(right.eventDate))
    : [];
  const series = namedSeries.length >= 2 ? namedSeries : numberedSeries;
  if (series.length < 2 || series.at(-1)?._id !== current._id) return null;
  const withDocuments = series.map((event) => ({
    event,
    documents: selectDropboxBarSourceDocuments(event.documents),
  }));
  const poOwners = withDocuments.filter(({ documents }) => documents.some((document) => (
    document?.type === 'po' && Array.isArray(document?.barItems) && document.barItems.length > 0
  )));
  if (poOwners.length !== 1 || poOwners[0].event._id === current._id) return null;
  const currentDocuments = withDocuments.find(({ event }) => event._id === current._id)?.documents || [];
  const sharedPoDocuments = poOwners[0].documents.filter((document) => document?.type === 'po');
  return {
    documents: [...currentDocuments.filter((document) => document?.type !== 'po'), ...sharedPoDocuments],
    sourceEventId: poOwners[0].event._id,
    eventIds: series.map((event) => event._id),
    startDate: series[0].eventDate,
    endDate: current.eventDate,
  };
};

const sourceDocumentSignature = (document = {}) => ({
  sourceId: String(document?.sourceId || ''),
  sourceRevision: String(document?.sourceRevision || ''),
  checksum: String(document?.checksum || ''),
  type: String(document?.type || ''),
  barItems: Array.isArray(document?.barItems) ? document.barItems : [],
});

export const buildDropboxBarSourceChecksum = (documents = []) => crypto
  .createHash('sha256')
  .update(JSON.stringify((Array.isArray(documents) ? documents : [])
    .map(sourceDocumentSignature)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))))
  .digest('hex');

export const hasAppliedDropboxBarSourceChecksum = (barEvent, checksum) => {
  const latestSourceSync = [...(Array.isArray(barEvent?.audit) ? barEvent.audit : [])]
    .reverse()
    .find((entry) => ['dropbox_documents_synced', 'caterease_operations_synced'].includes(String(entry?.action || '')));
  return String(latestSourceSync?.action || '') === 'dropbox_documents_synced'
    && String(latestSourceSync?.details?.checksum || '') === String(checksum || '');
};
