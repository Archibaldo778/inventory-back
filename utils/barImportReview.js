import BarEvent from '../models/BarEvent.js';
export const barImportIssues = (documents = []) => documents.filter((doc) => doc.barReview?.status === 'needs_review')
  .flatMap((doc) => (doc.barReview.issues || ['Document requires review']).map((issue) => `${doc.fileName || 'Document'}: ${issue}`)).slice(0, 30);
export async function blockUnverifiedBarImport(event, documents, Model = BarEvent) {
  const issues = barImportIssues(documents);
  if (!issues.length) return false;
  // Atomic metadata-only update: never replace items or touch returns on a failed scan.
  await Model.updateOne({ linkedEventId: event._id }, {
    $set: { importReview: { status: 'needs_review', issues } },
    $setOnInsert: { linkedEventId: event._id, name: event.title || 'Untitled event', eventDate: event.date, status: 'draft' },
  }, { upsert: true });
  return true;
}
