import crypto from 'node:crypto';
import { createApiError } from './apiErrors.js';

export const VENUE_CATEGORIES = ['boh', 'loading', 'access', 'equipment', 'rules', 'other'];
export const VENUE_KINDS = ['concern', 'positive', 'information'];
export const VENUE_STATUSES = ['active', 'needs_review', 'resolved'];
export const normalizeVenuePart = (value) => String(value || '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const usableVenueName = (value) => Boolean(normalizeVenuePart(value))
  && !['tbd', 'n a', 'na', 'none', 'unknown', 'off site', 'private residence'].includes(normalizeVenuePart(value));
export const eventVenue = (event) => ({
  name: String(event?.meta?.venue || event?.meta?.nowsta?.venue || event?.catereaseOperations?.eventVenue || '').trim(),
  address: String(event?.meta?.address || event?.meta?.nowsta?.address || '').trim(),
});
export const venueIdentityKey = (name, address) => `${normalizeVenuePart(name)}|${normalizeVenuePart(address)}`;
export const venueIdentity = (body = {}) => {
  const name = String(body.name || '').trim(); const address = String(body.address || '').trim();
  if (!usableVenueName(name) || !normalizeVenuePart(address) || name.length > 300 || address.length > 600) {
    throw createApiError(400, 'A venue name and full address are required');
  }
  if (body.aliases !== undefined && !Array.isArray(body.aliases)) throw createApiError(400, 'Aliases must be a list');
  const aliases = [...new Set((body.aliases || []).map((value) => String(value).trim()).filter(Boolean))];
  if (aliases.length > 30 || aliases.some((value) => value.length > 300 || !usableVenueName(value))) throw createApiError(400, 'Use up to 30 valid venue aliases');
  return { name, address, aliases, identityKeys: [...new Set([name, ...aliases].map((value) => venueIdentityKey(value, address)))] };
};
export const expectedVenueRevision = (value) => {
  if (!Number.isInteger(value) || value < 0) throw createApiError(400, 'A current revision is required');
  return value;
};
export const venueNoteMetadata = (body = {}) => {
  const { category, kind, status } = body;
  if (!VENUE_CATEGORIES.includes(category) || !VENUE_KINDS.includes(kind) || !VENUE_STATUSES.includes(status)) throw createApiError(400, 'Choose a valid category, note type and status');
  const resolution = String(body.resolution || '').trim();
  if (resolution.length > 2000 || (status === 'resolved' && !resolution)) throw createApiError(400, 'Explain how this note was resolved (up to 2,000 characters)');
  return { category, kind, status, resolution };
};
export const venueNotesFingerprint = (notes) => crypto.createHash('sha256').update(JSON.stringify(notes
  .map((note) => [String(note._id), note.revision || 0, note.text, note.kind, note.status, note.resolution])
  .sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');

export const captainVenueNotes = (report) => [
  ['venueAccessNotes', 'access', 'Venue access'],
  ['venueKitchenNotes', 'boh', 'Kitchen / BOH'],
  ['rentalEquipmentComments', 'equipment', 'Rental equipment'],
].flatMap(([field, category, label]) => {
  const text = typeof report?.answers?.[field] === 'string' ? report.answers[field].trim() : '';
  if (!text || /^(?:n\/?a|none|—|-|no comments?)\.?$/i.test(text)) return [];
  return [{ sourceKey: `captain:${report._id}:${field}`, source: 'captain', sourceReportId: report._id,
    sourceEventId: report.eventId, sourceLabel: `${report.reporterName || 'Captain'} · ${label}`,
    sourceDate: report.eventDate || '', observedAt: report.submittedAt, text, category, kind: 'information', status: 'needs_review' }];
});

export const venueNoteReports = (notes) => notes.filter((note) => note.status !== 'resolved' && note.kind !== 'positive')
  .flatMap((note) => {
    const chunks = String(note.text || '').match(/[\s\S]{1,1800}/g) || [];
    return chunks.map((text, index) => ({ _id: `${note._id}:${index}`, eventId: note.sourceEventId || '',
      eventDate: note.sourceDate, reporterName: note.sourceLabel || (note.source === 'caterease' ? 'Caterease venue notes' : 'Venue note'),
      reportType: 'captain', status: 'submitted', answers: { venueKitchenNotes: text },
      venueId: String(note.venueId), venueNoteId: String(note._id), venueNoteRevision: note.revision || 0,
      source: note.source, sourceReportId: note.sourceReportId ? String(note.sourceReportId) : '',
    }));
  });
