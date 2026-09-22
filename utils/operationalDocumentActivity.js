import { findDropboxEventMatch, inferDropboxPathDate, inferDropboxRevision } from './dropboxDocuments.js';
import { isRestrictedEventDocument } from './eventFileVisibility.js';
import { inferOperationalStatusType } from './operationalDocumentStatus.js';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const TYPE_LABELS = Object.freeze({ sr: 'SR', km: 'KM', po: 'PO', rental: 'Rental' });

const timestamp = (value) => {
  const result = new Date(value || 0).getTime();
  return Number.isFinite(result) ? result : 0;
};

const documentRevision = (document) => {
  const stored = Number(document?.revisionNumber);
  if (Number.isSafeInteger(stored) && stored > 0) return stored;
  return inferDropboxRevision(clean(document?.path || document?.name)).number;
};

const activityTimestamp = (document) => Math.max(
  timestamp(document?.serverModifiedAt),
  timestamp(document?.clientModifiedAt),
) || timestamp(document?.firstSeenAt);

const isFile = (document) => /\.[a-z0-9]{2,5}$/i.test(clean(document?.name || document?.path).split('/').at(-1) || '');

export const buildOperationalDocumentActivities = (documents = [], events = [], { since = 0, today = '' } = {}) => {
  const eventRows = Array.isArray(events) ? events : [];
  const eventById = new Map(eventRows.map((event) => [String(event?._id || event?.id || ''), event]));
  const grouped = new Map();

  (Array.isArray(documents) ? documents : []).forEach((document) => {
    const identity = clean(document?.path || document?.name);
    if (!identity || !isFile(document) || isRestrictedEventDocument(identity)) return;
    const type = inferOperationalStatusType(identity);
    if (!type) return;
    const activityAt = activityTimestamp(document);
    if (!activityAt || activityAt < Number(since || 0)) return;

    const importedEvent = eventById.get(String(document?.importedEventId || ''));
    const match = importedEvent ? { status: 'matched', event: importedEvent } : findDropboxEventMatch({
      ...document,
      inferredDate: clean(document?.inferredDate) || inferDropboxPathDate(identity),
    }, eventRows);
    if (match.status !== 'matched') return;
    const event = match.event;
    const eventId = String(event?._id || event?.id || '');
    const eventDate = clean(event?.date).slice(0, 10);
    if (!eventId || (today && eventDate && eventDate < today)) return;
    const revision = documentRevision(document);
    const row = { document, event, eventId, type, revision, activityAt };
    const key = `${eventId}:${type}`;
    const current = grouped.get(key);
    if (!current || (revision ?? -1) > (current.revision ?? -1)
      || ((revision ?? -1) === (current.revision ?? -1) && activityAt > current.activityAt)) {
      grouped.set(key, row);
    }
  });

  return [...grouped.values()].map(({ document, event, eventId, type, revision, activityAt }) => {
    const firstSeenAt = timestamp(document?.firstSeenAt);
    const modifiedAt = Math.max(timestamp(document?.serverModifiedAt), timestamp(document?.clientModifiedAt));
    const action = revision ? 'revision' : modifiedAt > firstSeenAt + 60_000 ? 'updated' : 'added';
    return {
      id: `${clean(document?.dropboxId) || clean(document?._id) || eventId}:${clean(document?.rev) || activityAt}`,
      eventId,
      eventExternalId: clean(event?.externalId || event?.eventId),
      eventTitle: clean(event?.title || event?.name) || 'Untitled event',
      eventDate: clean(event?.date).slice(0, 10),
      managerId: clean(event?.managerId),
      type,
      documentLabel: TYPE_LABELS[type],
      revision,
      action,
      fileName: clean(document?.name) || clean(document?.path).split('/').at(-1) || '',
      updatedAt: new Date(activityAt).toISOString(),
    };
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};
