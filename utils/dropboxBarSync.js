import crypto from 'node:crypto';

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
