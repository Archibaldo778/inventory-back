import crypto from 'node:crypto';
import { selectLatestDropboxFileRevisions } from './dropboxDocuments.js';
import { BAR_AI_VERSION } from './barDocumentAi.js';
import { barItemsHaveRecordedReturns } from './barSourceChangeProtection.js';
import { runImportedBarItemMergePipeline } from './barManualItems.js';
import { getPreparedBeverageType } from './barPackoutScope.js';

export const recheckSourceSignature = (documents, rulesRevision = 0) => crypto.createHash('sha256').update(JSON.stringify({
  version: BAR_AI_VERSION, recheckVersion: 9, rulesRevision, model: process.env.BAR_DOCUMENT_AI_MODEL || 'gpt-5.6-luna',
  sources: documents.map((d) => [String(d._id), d.type, d.sourceProvider, d.sourceId, d.sourceRevision, d.checksum]).sort(),
})).digest('hex');

const isMenuUpload = (entry) => entry.action === 'packout_imported'
  && /\bKM(?:\s+REV\s*\d+)?\.docx$/i.test(entry.details?.fileName || '');

export const selectAutomaticRecheckSources = (documents = []) => {
  const automatic = documents.filter((d) => ['dropbox', 'caterease'].includes(d.sourceProvider) && ['po', 'kitchen_menu'].includes(d.type));
  const manual = documents.filter((d) => !automatic.includes(d));
  if (!manual.length) return automatic;
  // A manually uploaded menu must not freeze quantities from the operational PO.
  // Unknown uploads and manual POs remain authoritative.
  if (manual.some((d) => d.type !== 'kitchen_menu') || !automatic.some((d) => d.type === 'po')) return [];
  return automatic.filter((d) => d.type === 'po');
};

export const protectedBarRecheckReason = (bar = {}) => {
  if (barItemsHaveRecordedReturns(bar)) return 'Confirmed report or recorded returns';
  if (bar.packout?.seriesEventIds?.length > 1 || bar.items?.some((item) => item.carryover?.sourceEventId)) return 'Shared packout or carryover';
  if (bar.items?.some((item) => item.entrySource === 'manual' || item.updatedBy || item.updatedAt || item.deliveredQty !== null && item.deliveredQty !== undefined)) return 'Manual edits or received quantities';
  if ((bar.audit || []).some((entry) => ['packout_imported', 'item_deleted', 'item_updated', 'manual_item_added', 'sent_quantity_changed', 'packout_item_updated', 'packout_item_deleted', 'return_updated', 'returns_batch_updated', 'returns_submitted', 'event_closed', 'returns_reviewed'].includes(entry.action) && !isMenuUpload(entry))) return 'Office-reviewed or edited packout';
  return '';
};

// Historical copies can remain attached after an event folder is renamed.
// Within this explicitly selected event, the same filename family is one PO/KM.
export const selectRecheckDocumentVersions = (documents) => {
  const kitchenPackout = (document) => /\bkpo\b/i.test(document.fileName || '');
  const hasSeparatePo = documents.some((document) => document.type === 'po' && !kitchenPackout(document));
  return selectLatestDropboxFileRevisions(
    documents.filter((document) => !hasSeparatePo || !kitchenPackout(document))
      .map((document) => ({ ...document, relativePath: document.fileName, modifiedAt: document.uploadedAt })),
  );
};

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
  // This is a review of every current source, not a partial single-file upload.
  // Do not retain stale notes/headings merely because they were classified as drinks before.
  if (!documentTypes.includes('po')) {
    const missingCounts = (bar.items || []).filter((previous) => previous.sentQtyPending !== true && Number(previous.sentQty) > 0
      && !items.some((item) => plainName(item.name) === plainName(previous.name)));
    if (missingCounts.length) return { status: 'needs_review', issues: missingCounts.map((item) => `Previous PO quantity has no current PO source: ${item.name}`) };
  }
  const merged = runImportedBarItemMergePipeline({ existingItems: bar.items || [], importedItems: items,
    documentTypes: (bar.audit || []).some(isMenuUpload) && documentTypes.includes('po') ? ['po'] : ['po', 'kitchen_menu'], eventDate: bar.eventDate, scheduledBy: 'Automatic document recheck' });
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

const onlyPricingChanged = (before, current) => {
  const previousAudit = before.audit || [];
  const currentAudit = current.audit || [];
  const added = currentAudit.slice(previousAudit.length);
  if (!added.length || added.some((entry) => entry.action !== 'caterease_client_pricing_synced')
    || JSON.stringify(currentAudit.slice(0, previousAudit.length)) !== JSON.stringify(previousAudit)) return false;
  const pricingFields = new Set(['revision', '__v', 'updatedAt', 'audit', 'clientCharge', 'clientChargeDetails', 'catereaseClientChargeSnapshot']);
  return [...new Set([...Object.keys(before), ...Object.keys(current)])]
    .filter((key) => !pricingFields.has(key))
    .every((key) => JSON.stringify(before[key]) === JSON.stringify(current[key]));
};

export const canCommitBarRecheck = ({ beforeBar, currentBar, beforeDocuments, currentDocuments, rulesRevision, signature }) => Boolean(
  currentBar && !protectedBarRecheckReason(currentBar)
  && (currentBar.revision === beforeBar.revision || onlyPricingChanged(beforeBar, currentBar))
  && JSON.stringify(currentBar.items) === JSON.stringify(beforeBar.items)
  && JSON.stringify(currentDocuments) === JSON.stringify(beforeDocuments)
  && recheckSourceSignature(selectAutomaticRecheckSources(currentDocuments), rulesRevision) === signature
);

// Repair today's and future automatic imports; never reopen past events.
export const barDocumentRecheckQuery = (now = new Date()) => ({
  eventDate: { $gte: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now), $regex: /^\d{4}-\d{2}-\d{2}$/ },
  status: { $nin: ['submitted', 'reviewed', 'closed'] },
});
