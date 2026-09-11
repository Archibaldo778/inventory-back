import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Event from '../models/Event.js';
import { documentZoneKey, normalizeCatereaseEventId } from '../utils/catereaseFiles.js';
import { inferDropboxPathDate, nyToday } from '../utils/dropboxDocuments.js';

// One-time recovery for the incident where enabling Caterease as the primary document source
// archived every Dropbox document for an event into documentHistory, even when Caterease had
// not actually returned a replacement for that document's type + zone. Nothing was deleted —
// this restores whichever Dropbox document has no matching current replacement back into
// `documents`, and leaves any document that genuinely has a Caterease replacement archived.

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(rootDir, envFile) });
dotenv.config({ path: path.join(rootDir, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const productionTarget = args.includes('--production');
const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const eventFilter = normalizeCatereaseEventId(
  args.find((arg) => arg.startsWith('--event='))?.slice('--event='.length) || ''
);

const timestamp = (document) => new Date(document?.uploadedAt || 0).getTime() || 0;
const calendarDate = (value) => {
  const parsed = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
};
const revisionFamilyKey = (document) => `${String(document?.type || '').trim().toLowerCase()}:${String(document?.fileName || '')
  .trim()
  .toLowerCase()
  .replace(/\.[^.]+$/, '')
  .replace(/\b\d{1,2}[-_.]\d{1,2}(?:[-_.](?:20)?\d{2})?\b/g, ' date ')
  .replace(/\b(?:revision|rev(?:ision)?|version|ver)\s*[-_.#:]?\s*\d{1,4}\b/g, ' ')
  .replace(/(?:^|[\s._-])v\s*[-_.#:]?\s*\d{1,4}(?=$|[\s._-])/g, ' ')
  .replace(/\s+copy(?:\s+\d+)?$/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()}`;
const isExplicitlyArchivedDropboxPath = (document) => {
  const source = `${document?.sourcePath || ''}|${document?.sourceSeries || ''}`.toLowerCase();
  return /(?:^|[\/|])(?:old|archive|archived|cancelled)(?:[\/|]|$)/.test(source);
};

const run = async () => {
  const mongoUri = String(productionTarget ? process.env.MONGO_URI_PROD : process.env.MONGO_URI || '').trim();
  const mongoDbName = String(
    productionTarget ? (process.env.MONGO_DB_NAME_PROD || 'test') : (process.env.MONGO_DB_NAME || '')
  ).trim();
  if (!mongoUri) throw new Error(productionTarget ? 'MONGO_URI_PROD is required' : 'MONGO_URI is required');
  if (apply && confirmation !== 'RESTORE_DROPBOX_DOCUMENTS') {
    throw new Error('Apply mode requires --confirm=RESTORE_DROPBOX_DOCUMENTS. Run without --apply first.');
  }

  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`target: ${productionTarget ? 'PRODUCTION' : 'DEFAULT'}`);
  if (eventFilter) console.log(`scope: single event ${eventFilter}`);

  const connectOptions = {};
  if (mongoDbName) connectOptions.dbName = mongoDbName;
  await mongoose.connect(mongoUri, connectOptions);

  let scanned = 0;
  let eventsAffected = 0;
  let documentsRestored = 0;

  try {
    const query = { status: { $ne: 'deleted' } };
    const today = nyToday();
    const cursor = Event.find(query).cursor();
    for await (const event of cursor) {
      scanned += 1;
      if (eventFilter && normalizeCatereaseEventId(event.externalId) !== eventFilter) continue;
      if (!eventFilter && calendarDate(event.date) < today) continue;

      const currentDocuments = Array.isArray(event.documents) ? event.documents : [];
      const eventDate = calendarDate(event.date);
      const currentZoneKeys = new Set(currentDocuments.map((document) => documentZoneKey(document)));
      const currentChecksums = new Set(currentDocuments.map((document) => String(document?.checksum || '').trim()).filter(Boolean));
      const currentDropboxFamilies = new Set(currentDocuments.filter((document) => (
        String(document?.sourceProvider || '').toLowerCase() === 'dropbox'
      )).map(revisionFamilyKey));
      const history = Array.isArray(event.documentHistory) ? event.documentHistory : [];
      const dropboxHistory = history.filter((document) => (
        String(document?.sourceProvider || '').toLowerCase() === 'dropbox'
        && !isExplicitlyArchivedDropboxPath(document)
        && (!inferDropboxPathDate(document?.fileName) || inferDropboxPathDate(document.fileName) === eventDate)
        && (!String(document?.checksum || '').trim() || !currentChecksums.has(String(document.checksum).trim()))
        && !currentDropboxFamilies.has(revisionFamilyKey(document))
      ));
      if (!dropboxHistory.length) continue;

      const bestByZone = new Map();
      dropboxHistory.forEach((document) => {
        const zoneKey = documentZoneKey(document);
        if (currentZoneKeys.has(zoneKey)) return; // a real replacement already exists — leave archived
        const best = bestByZone.get(zoneKey);
        if (!best || timestamp(document) > timestamp(best)) bestByZone.set(zoneKey, document);
      });
      const bestByContent = new Map();
      [...bestByZone.values()].forEach((document) => {
        const checksum = String(document.checksum || '').trim();
        const contentKey = checksum || `${documentZoneKey(document)}:${String(document.fileName || '').toLowerCase()}`;
        const best = bestByContent.get(contentKey);
        if (!best || timestamp(document) > timestamp(best)) bestByContent.set(contentKey, document);
      });
      const bestByRevisionFamily = new Map();
      [...bestByContent.values()].forEach((document) => {
        const familyKey = revisionFamilyKey(document);
        const best = bestByRevisionFamily.get(familyKey);
        if (!best || timestamp(document) > timestamp(best)) bestByRevisionFamily.set(familyKey, document);
      });
      const toRestore = [...bestByRevisionFamily.values()];
      if (!toRestore.length) continue;

      eventsAffected += 1;
      documentsRestored += toRestore.length;
      console.log(
        `${event.externalId || event._id} · ${event.title || 'Untitled event'} (${event.date}): `
        + `restoring ${toRestore.length} document(s) — ${toRestore.map((document) => (
          `${document.fileName} [${documentZoneKey(document)}; checksum:${String(document.checksum || '').slice(0, 12) || 'none'}; uploaded:${document.uploadedAt || 'unknown'}]`
        )).join(', ')}`
      );
      if (!apply) continue;

      const restoredIds = new Set(toRestore.map((document) => String(document._id)));
      event.documents = [...currentDocuments, ...toRestore];
      event.documentHistory = history.filter((document) => !restoredIds.has(String(document._id)));
      await event.save();
    }

    console.log(`restore-archived-dropbox-documents: scanned=${scanned}, eventsAffected=${eventsAffected}, documentsRestored=${documentsRestored}`);
    if (!apply) {
      console.log(
        'Dry-run complete. To apply: node scripts/restore-archived-dropbox-documents.mjs '
        + '--apply --confirm=RESTORE_DROPBOX_DOCUMENTS'
        + (eventFilter ? ` --event=${eventFilter}` : '')
      );
    }
  } finally {
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error('restore-archived-dropbox-documents failed:', error?.message || error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => null);
  }
  process.exitCode = 1;
});
