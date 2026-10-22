import BarEvent from '../models/BarEvent.js';
export const barImportIssues = (documents = []) => documents.flatMap((doc) =>
  [...new Set([...(doc.barReview?.issues || []), ...(doc.barReview?.warnings || [])])]
    .map((issue) => `${doc.fileName || 'Document'}: ${issue}`));
export const buildBarImportReview = (documents = [], audit = []) => {
  const issues = barImportIssues(documents);
  const excluded = new Set(audit.filter((entry) => entry.action === 'document_row_reviewed' && entry.details?.action === 'exclude').map((entry) => entry.details.row?.id));
  const rows = documents.flatMap((doc) => (doc.barReview?.rows || []).map((row) => ({ ...row,
    id: `${doc.checksum || doc.sourceId || doc.fileName}:${row.row}:${String(row.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`, fileName: doc.fileName }))).filter((row) => !excluded.has(row.id));
  const failed = documents.some((doc) => doc.barReview?.status === 'needs_review');
  return issues.length || rows.length || failed ? { status: failed ? 'needs_review' : 'warnings', issues, rows,
    partial: documents.some((doc) => doc.barReview?.status === 'verified') } : undefined;
};
export async function blockUnverifiedBarImport(event, documents, Model = BarEvent) {
  const review = buildBarImportReview(documents);
  if (!review || documents.some((doc) => doc.barReview?.status === 'verified')) return false;
  await Model.updateOne({ linkedEventId: event._id }, {
    $set: { importReview: review },
    $setOnInsert: { linkedEventId: event._id, name: event.title || 'Untitled event', eventDate: event.date, status: 'draft' },
  }, { upsert: true });
  return !documents.some((doc) => doc.barReview?.status === 'verified');
}

// A failed source cannot erase counted stock supplied by an earlier successful read.
export const preserveUninspectedBarItems = (existing, incoming, documents) => {
  if (!documents.some((d) => d.barReview?.status !== 'verified')) return incoming;
  const key = (item) => String(item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = new Set(incoming.map(key));
  return [...incoming, ...(existing || []).filter((item) => !names.has(key(item)) && !item.sentQtyPending && Number(item.sentQty) > 0)];
};
