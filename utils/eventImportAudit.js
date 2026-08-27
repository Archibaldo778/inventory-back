const clean = (value) => String(value ?? '').trim();

const cloneValue = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

export const EVENT_IMPORT_SNAPSHOT_FIELDS = Object.freeze([
  'externalId',
  'title',
  'date',
  'client',
  'managerId',
  'status',
  'importSource',
  'meta',
]);

export const snapshotImportedEvent = (event) => Object.fromEntries(
  EVENT_IMPORT_SNAPSHOT_FIELDS.map((field) => [field, cloneValue(event?.[field])])
);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
};

export const importedEventMatchesSnapshot = (event, snapshot) => {
  if (!event || !snapshot) return false;
  return EVENT_IMPORT_SNAPSHOT_FIELDS.every((field) => (
    JSON.stringify(stableValue(cloneValue(event?.[field])))
      === JSON.stringify(stableValue(cloneValue(snapshot?.[field])))
  ));
};

export const summarizeImportOperations = (operations = []) => {
  const rows = Array.isArray(operations) ? operations : [];
  const summary = {
    processed: 0,
    created: 0,
    updated: 0,
    eventIdsAssigned: 0,
    duplicatesMerged: 0,
    failed: 0,
    skipped: 0,
  };
  rows.forEach((operation) => {
    const action = clean(operation?.action);
    if (action === 'created') summary.created += 1;
    if (action === 'updated') summary.updated += 1;
    if (action === 'event_id_assigned') {
      summary.updated += 1;
      summary.eventIdsAssigned += 1;
    }
    if (action === 'duplicates_merged') {
      summary.updated += 1;
      summary.duplicatesMerged += 1;
    }
    if (action === 'failed') summary.failed += 1;
    if (action === 'skipped') summary.skipped += 1;
    if (!['failed', 'skipped'].includes(action)) summary.processed += 1;
  });
  return summary;
};
