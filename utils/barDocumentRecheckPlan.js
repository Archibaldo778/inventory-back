import crypto from 'node:crypto';
import { selectLatestDropboxFileRevisions } from './dropboxDocuments.js';
import { BAR_AI_VERSION } from './barDocumentAi.js';
import { barItemsHaveRecordedReturns } from './barSourceChangeProtection.js';
import { runImportedBarItemMergePipeline } from './barManualItems.js';
import { getPreparedBeverageType } from './barPackoutScope.js';

export const recheckSourceSignature = (documents, rulesRevision = 0) => crypto.createHash('sha256').update(JSON.stringify({
  version: BAR_AI_VERSION, recheckVersion: 4, rulesRevision, model: process.env.BAR_DOCUMENT_AI_MODEL || 'gpt-5.6-luna',
  sources: documents.map((d) => [String(d._id), d.type, d.sourceProvider, d.sourceId, d.sourceRevision, d.checksum]).sort(),
})).digest('hex');

export const protectedBarRecheckReason = (bar = {}) => {
  if (barItemsHaveRecordedReturns(bar)) return 'Confirmed report or recorded returns';
  if (bar.packout?.seriesEventIds?.length > 1 || bar.items?.some((item) => item.carryover?.sourceEventId)) return 'Shared packout or carryover';
  if (bar.items?.some((item) => item.entrySource === 'manual' || item.updatedBy || item.updatedAt || item.deliveredQty !== null && item.deliveredQty !== undefined)) return 'Manual edits or received quantities';
  if ((bar.audit || []).some((entry) => ['packout_imported', 'item_deleted', 'item_updated', 'manual_item_added', 'sent_quantity_changed', 'packout_item_updated', 'packout_item_deleted', 'return_updated', 'returns_batch_updated', 'returns_submitted', 'event_closed', 'returns_reviewed'].includes(entry.action))) return 'Office-reviewed or edited packout';
  return '';
};

// Historical copies can remain attached after an event folder is renamed.
// Within this explicitly selected event, the same filename family is one PO/KM.
export const selectRecheckDocumentVersions = (documents) => selectLatestDropboxFileRevisions(
  documents.map((document) => ({ ...document, relativePath: document.fileName, modifiedAt: document.uploadedAt })),
);

const plainName = (value) => String(value || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
export function planBarDocumentRecheck(bar, importedItems, documentTypes) {
  const reason = protectedBarRecheckReason(bar);
  if (reason) return { status: 'protected', reason };
  // A PO often omits a menu's parenthetical recipe alias. Use only an unambiguous match.
  const items = importedItems.map((item) => {
    if (!getPreparedBeverageType(item)) return item;
    const matches = [...importedItems, ...(bar.items || [])].filter((other) => getPreparedBeverageType(other)
      && plainName(other.name) === plainName(item.name));
    const names = [...new Set(matches.map((other) => other.name))];
    const fullNames = names.filter((name) => /\([^)]*\)/.test(name));
    return fullNames.length === 1 ? { ...item, name: fullNames[0] } : item;
  });
  const merged = runImportedBarItemMergePipeline({ existingItems: bar.items || [], importedItems: items,
    documentTypes, eventDate: bar.eventDate, scheduledBy: 'Automatic document recheck' });
  return { status: 'ready', items: merged.items };
}

export async function prepareBarDocumentRecheck({ bar, documents, read, normalize }) {
  const protectedReason = protectedBarRecheckReason(bar);
  if (protectedReason) return { status: 'protected', reason: protectedReason };
  if (documents.length > 12) return { status: 'needs_review', issues: ['Too many distinct source documents for one automatic inspection'] };
  const parsed = [];
  for (const document of selectRecheckDocumentVersions(documents)) {
    const metadata = await read(document);
    if (metadata.barReview?.status !== 'verified') return { status: metadata.barReview?.retryable ? 'retry' : 'needs_review', issues: (metadata.barReview?.issues || ['Document could not be verified']).map((issue) => `${document.fileName}: ${issue}`) };
    parsed.push({ ...document, barItems: metadata.barItems, barReview: metadata.barReview });
  }
  const poWines = parsed.filter((d) => d.type === 'po').flatMap((d) => d.barItems).filter((item) => item.scope === 'alcohol');
  const sourceItems = parsed.flatMap((document) => (document.barItems || []).map((item) => {
    if (document.type !== 'kitchen_menu' || item.scope !== 'alcohol') return item;
    // KM "Chateau Gloria- Red" and PO "Red Bordeaux (Chateau Gloria)" are one wine.
    // Require the full named alias, matching color, and exactly one PO name.
    const match = String(item.name || '').match(/^(.+?)\s*[-–—]\s*(white|red|ros[eé])$/i);
    if (!match) return item;
    const alias = plainName(match[1]);
    const color = match[2].toLowerCase();
    const names = [...new Set(poWines.filter((wine) => new RegExp(`\\b${color}\\b`, 'i').test(wine.name)
      && [...wine.name.matchAll(/\(([^)]+)\)/g)].some((part) => plainName(part[1]) === alias)).map((wine) => wine.name))];
    return names.length === 1 ? { ...item, name: names[0] } : item;
  }));
  const imported = await normalize(sourceItems, { guestCount: bar.guestCount, allowFinancials: false });
  return { ...planBarDocumentRecheck(bar, imported, [...new Set(documents.map((d) => d.type))]), documents: parsed };
}

export const canCommitBarRecheck = ({ beforeBar, currentBar, beforeDocuments, currentDocuments, rulesRevision, signature }) => Boolean(
  currentBar && !protectedBarRecheckReason(currentBar)
  && currentBar.revision === beforeBar.revision
  && JSON.stringify(currentBar.items) === JSON.stringify(beforeBar.items)
  && JSON.stringify(currentDocuments) === JSON.stringify(beforeDocuments)
  && recheckSourceSignature(currentDocuments.filter((d) => ['dropbox', 'caterease'].includes(d.sourceProvider)), rulesRevision) === signature
);

// Explicitly requested historical repair. No other past events are enrolled automatically.
export const barDocumentRecheckQuery = () => ({
  linkedEventId: { $in: ['6aa993cb55df57b2093ba0b2'] },
  status: { $nin: ['submitted', 'reviewed', 'closed'] },
});
