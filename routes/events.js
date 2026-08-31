import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { fileURLToPath } from 'url';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import Proposal from '../models/Proposal.js';
import Client from '../models/Client.js';
import DecorPackout from '../models/DecorPackout.js';
import BarEvent from '../models/BarEvent.js';
import BarTask from '../models/BarTask.js';
import BeverageItem from '../models/BeverageItem.js';
import ImportRun from '../models/ImportRun.js';
import DocumentImportRun from '../models/DocumentImportRun.js';
import { requireAdmin, requireRoles } from '../middleware/auth.js';
import { clearApiCacheGroups, createGroupedApiCache } from '../utils/apiCache.js';
import { sendApiError } from '../utils/apiErrors.js';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';
import {
  importedEventMatchesSnapshot,
  snapshotImportedEvent,
  summarizeImportOperations,
} from '../utils/eventImportAudit.js';
import {
  applyBarDocumentImportSnapshot,
  barDocumentImportMatchesSnapshot,
  eventDocumentsMatchSnapshot,
  mergeEventDocumentHistory,
  nextEventDocumentVersion,
  snapshotEventDocuments,
} from '../utils/documentImportAudit.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_GROUP = 'events';
const cacheWithGroup = createGroupedApiCache;

const clearCache = () => clearApiCacheGroups(CACHE_GROUP);
const clearRelatedCaches = () => {
  clearApiCacheGroups(CACHE_GROUP, 'decks', 'pages', 'proposals', 'bar');
};

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const MAX_IMPORT_ROWS = 2_000;
const trimImportValue = (value, maxLength = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const EVENT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
const eventDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVENT_DOCUMENT_MAX_BYTES, files: 1, fields: 10, parts: 11 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const normalizeEventDocumentType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['po', 'kitchen_menu'].includes(normalized) ? normalized : '';
};

const parseKitchenDocumentItems = (value) => {
  if (!value) return [];
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { return []; }
  }
  if (!Array.isArray(source)) return [];
  return source.slice(0, 500).map((item) => ({
    name: trimImportValue(item?.name, 300),
    normalizedName: trimImportValue(item?.normalizedName, 300).toLowerCase(),
    section: trimImportValue(item?.section, 200),
  })).filter((item) => item.name);
};

const isDocxUpload = (file) => {
  if (!file?.buffer || file.buffer.length < 4) return false;
  const fileName = String(file.originalname || '');
  const zipSignature = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  return /\.docx$/i.test(fileName) && zipSignature;
};

const uploadEventDocument = (file, eventId, type, version) => new Promise((resolve, reject) => {
  const publicId = `event-documents/${eventId}/${type}-v${version}-${crypto.randomUUID()}.docx`;
  const stream = cloudinary.uploader.upload_stream({
    resource_type: 'raw',
    public_id: publicId,
    overwrite: false,
  }, (error, result) => {
    if (error) return reject(error);
    resolve({ url: result?.secure_url || result?.url || '', publicId: result?.public_id || publicId });
  });
  stream.end(file.buffer);
});

const writeLocalEventDocument = async (file, eventId, type, version) => {
  const directory = path.join(__dirname, '..', 'uploads', 'event-documents');
  await fs.promises.mkdir(directory, { recursive: true });
  const fileName = `${eventId}-${type}-v${version}-${crypto.randomUUID()}.docx`;
  await fs.promises.writeFile(path.join(directory, fileName), file.buffer);
  return { url: `/uploads/event-documents/${fileName}`, publicId: '' };
};

const storeEventDocument = async (file, eventId, type, version) => {
  const hasCloudinary = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  if (hasCloudinary) return uploadEventDocument(file, eventId, type, version);
  return writeLocalEventDocument(file, eventId, type, version);
};

const cleanupEventDocument = async (document) => {
  const publicId = String(document?.publicId || '').trim();
  if (publicId) {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', invalidate: true }).catch(() => null);
    return;
  }
  const url = String(document?.url || '');
  if (!url.startsWith('/uploads/event-documents/')) return;
  const target = path.join(__dirname, '..', url.replace(/^\/+/, ''));
  await fs.promises.unlink(target).catch(() => null);
};

const importedEventFailureMessage = (error) => {
  if (Number(error?.code) === 11000) return 'Duplicate Event ID conflict.';
  if (String(error?.name || '') === 'ValidationError') return 'Event data did not pass validation.';
  return 'Event could not be imported.';
};

export const normalizeImportedEventMatchTitle = (value) => trimImportValue(value, 300)
  .replace(/\s*[-–—]\s*staffing(?:\s+set\s*up|_?\s*\d+\s*pax)?\s*$/i, '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const normalizeImportedEventBaseId = (value) => {
  const match = trimImportValue(value, 120).toUpperCase().match(/\bE\s*\d+\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
};

const findEventTitleDateMatches = async (event, session = null) => {
  const query = Event.find({
    date: event.date,
    status: { $not: /^deleted$/i },
  }).select('_id externalId importSource title date createdAt').sort({ createdAt: 1, _id: 1 });
  if (session) query.session(session);
  const candidates = await query.lean();
  const expectedTitle = normalizeImportedEventMatchTitle(event.title);
  return candidates.filter((candidate) => normalizeImportedEventMatchTitle(candidate.title) === expectedTitle);
};

const findManualEventMatches = async (event, excludeId = null, session = null) => {
  const matches = await findEventTitleDateMatches(event, session);
  const importedBaseId = normalizeImportedEventBaseId(event.externalId);
  return matches.filter((candidate) => (
    String(candidate.importSource || '').toLowerCase() !== 'nowsta'
    && (
      !String(candidate.externalId || '').trim()
      || (importedBaseId && normalizeImportedEventBaseId(candidate.externalId) === importedBaseId)
    )
    && (!excludeId || String(candidate._id) !== String(excludeId))
  ));
};

const findImportedNowstaDuplicates = async (event, targetEventId) => {
  const matches = await findEventTitleDateMatches(event);
  return matches.filter((candidate) => (
    String(candidate._id) !== String(targetEventId)
    && String(candidate.importSource || '').toLowerCase() === 'nowsta'
  ));
};

const prepareImportedRows = (sourceRows) => {
  const normalizedRows = sourceRows.map(normalizeImportedEvent).filter(Boolean);
  const uniqueRows = [];
  const seen = new Set();
  normalizedRows.forEach((event) => {
    const identity = event.externalId
      ? `id:${event.externalId.toLowerCase()}`
      : `event:${[event.title, event.date, event.client, event.managerId].map((value) => value.toLowerCase()).join('|')}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    uniqueRows.push({ ...event, identity });
  });
  return {
    normalizedRows,
    uniqueRows,
    skipped: sourceRows.length - uniqueRows.length,
  };
};

const resolveImportedEventTarget = async (event) => {
  let filter = event.externalId
    ? { externalId: event.externalId }
    : {
        title: event.title,
        date: event.date,
        client: event.client,
        managerId: event.managerId,
      };
  let assigningEventId = false;
  let duplicateEventIds = [];
  let conflict = '';
  let matchedEvent = null;

  if (event.externalId) {
    const existingById = await Event.findOne({
      externalId: event.externalId,
      status: { $not: /^deleted$/i },
    }).lean();
    if (existingById?._id) {
      const manualMatches = await findManualEventMatches(event, existingById._id);
      if (manualMatches.length === 1) {
        matchedEvent = await Event.findById(manualMatches[0]._id).lean();
        filter = { _id: manualMatches[0]._id };
        duplicateEventIds = (await findImportedNowstaDuplicates(event, manualMatches[0]._id))
          .map((candidate) => candidate._id);
        if (!duplicateEventIds.some((id) => String(id) === String(existingById._id))) {
          duplicateEventIds.push(existingById._id);
        }
        assigningEventId = true;
      } else {
        matchedEvent = existingById;
        filter = { _id: existingById._id };
      }
    } else {
      const manualMatches = await findManualEventMatches(event);
      if (manualMatches.length === 1) {
        matchedEvent = await Event.findById(manualMatches[0]._id).lean();
        filter = { _id: manualMatches[0]._id };
        duplicateEventIds = (await findImportedNowstaDuplicates(event, manualMatches[0]._id))
          .map((candidate) => candidate._id);
        assigningEventId = true;
      } else if (manualMatches.length > 1) {
        conflict = `${manualMatches.length} existing events have the same name and date. Resolve duplicates before importing.`;
      }
    }
  } else {
    matchedEvent = await Event.findOne({ ...filter, status: { $not: /^deleted$/i } }).lean();
    if (matchedEvent?._id) filter = { _id: matchedEvent._id };
  }

  const action = conflict
    ? 'skipped'
    : duplicateEventIds.length
      ? 'duplicates_merged'
      : assigningEventId
        ? 'event_id_assigned'
        : matchedEvent
          ? 'updated'
          : 'created';
  return { filter, assigningEventId, duplicateEventIds, conflict, matchedEvent, action };
};

const barItemMergeKey = (item) => {
  const inventoryId = String(item?.beverageItemId || '').trim();
  if (inventoryId) return `inventory:${inventoryId}`;
  const recipeKey = trimImportValue(item?.cocktailRecipeKey, 240).toLowerCase();
  if (recipeKey) return `recipe:${recipeKey}`;
  return `item:${[item?.name, item?.section, item?.entrySource]
    .map((value) => trimImportValue(value, 240).toLowerCase()).join('|')}`;
};

const mergeBarEventData = async (sourceEventId, targetEventId, session = null) => {
  const options = session ? { session } : {};
  const [sourceBarEvent, targetBarEvent] = await Promise.all([
    BarEvent.findOne({ linkedEventId: sourceEventId }, null, options),
    BarEvent.findOne({ linkedEventId: targetEventId }, null, options),
  ]);
  if (!sourceBarEvent) return;

  if (!targetBarEvent) {
    sourceBarEvent.linkedEventId = targetEventId;
    sourceBarEvent.audit.push({
      action: 'dashboard_event_merged',
      details: { sourceEventId: String(sourceEventId), targetEventId: String(targetEventId) },
    });
    await sourceBarEvent.save(options);
    return;
  }

  const existingKeys = new Set(targetBarEvent.items.map(barItemMergeKey));
  sourceBarEvent.items.forEach((item) => {
    const key = barItemMergeKey(item);
    if (existingKeys.has(key)) return;
    targetBarEvent.items.push(item.toObject ? item.toObject() : item);
    existingKeys.add(key);
  });
  targetBarEvent.assignedUserIds = [...new Set([
    ...targetBarEvent.assignedUserIds.map(String),
    ...sourceBarEvent.assignedUserIds.map(String),
  ])];
  const copyIfBlank = (field) => {
    if (targetBarEvent[field] === '' || targetBarEvent[field] === null || targetBarEvent[field] === undefined) {
      targetBarEvent[field] = sourceBarEvent[field];
    }
  };
  [
    'eventNumber',
    'venue',
    'salesRep',
    'eventTiming',
    'deliveryTime',
    'guestCount',
    'submittedAt',
    'submittedBy',
    'reviewedAt',
    'reviewedBy',
    'notes',
  ].forEach(copyIfBlank);
  if (!targetBarEvent.packout?.fileName && sourceBarEvent.packout?.fileName) {
    targetBarEvent.packout = sourceBarEvent.packout;
  }
  if (!targetBarEvent.clientCharge && sourceBarEvent.clientCharge) {
    targetBarEvent.clientCharge = sourceBarEvent.clientCharge;
    targetBarEvent.clientChargeDetails = sourceBarEvent.clientChargeDetails;
  }
  if (targetBarEvent.status === 'draft' && sourceBarEvent.status !== 'draft') {
    targetBarEvent.status = sourceBarEvent.status;
  }
  targetBarEvent.audit.push({
    action: 'dashboard_event_merged',
    details: {
      sourceEventId: String(sourceEventId),
      targetEventId: String(targetEventId),
      sourceBarEventId: String(sourceBarEvent._id),
    },
  });
  await targetBarEvent.save(options);
  await BarTask.updateMany(
    { eventId: sourceBarEvent._id },
    { $set: { eventId: targetBarEvent._id } },
    options
  );
};

const mergeImportedDuplicateIntoManualEvent = async (sourceEventId, targetEventId, session = null) => {
  const options = session ? { session } : {};
  const [sourceEvent, targetEvent] = await Promise.all([
    Event.findById(sourceEventId, null, options),
    Event.findById(targetEventId, null, options),
  ]);
  if (sourceEvent && targetEvent && Array.isArray(sourceEvent.documents) && sourceEvent.documents.length) {
    const documentsByType = new Map((targetEvent.documents || []).map((document) => [String(document.type), document]));
    const displacedDocuments = [];
    sourceEvent.documents.forEach((document) => {
      const current = documentsByType.get(String(document.type));
      if (!current || new Date(document.uploadedAt || 0) > new Date(current.uploadedAt || 0)) {
        if (current) displacedDocuments.push(current);
        documentsByType.set(String(document.type), document?.toObject ? document.toObject() : document);
      } else {
        displacedDocuments.push(document);
      }
    });
    targetEvent.documents = [...documentsByType.values()].map((document) => (
      document?.toObject ? document.toObject() : document
    ));
    targetEvent.documentHistory = mergeEventDocumentHistory(
      targetEvent.documentHistory,
      sourceEvent.documentHistory,
      displacedDocuments
    );
    await targetEvent.save(options);
  }
  await Promise.all([
    Deck.updateMany({ eventId: sourceEventId }, { $set: { eventId: targetEventId } }, options),
    Proposal.updateMany({ eventId: sourceEventId }, { $set: { eventId: targetEventId } }, options),
    DecorPackout.updateMany({ eventId: sourceEventId }, { $set: { eventId: targetEventId } }, options),
    BeverageItem.updateMany(
      { 'inventoryMovements.sourceEventId': sourceEventId },
      { $set: { 'inventoryMovements.$[movement].sourceEventId': targetEventId } },
      { ...options, arrayFilters: [{ 'movement.sourceEventId': sourceEventId }] }
    ),
  ]);
  await mergeBarEventData(sourceEventId, targetEventId, session);
  await Event.updateOne(
    { _id: sourceEventId },
    {
      $set: {
        externalId: '',
        status: 'deleted',
        'meta.mergedIntoEventId': String(targetEventId),
        'meta.mergedAt': new Date(),
      },
    },
    options
  );
};

const normalizeNowstaWorker = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const name = trimImportValue(source.name, 240);
  if (!name) return null;
  return {
    name,
    status: trimImportValue(source.status, 40).toLowerCase(),
    agency: Boolean(source.agency),
  };
};

const normalizeNowstaShift = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const position = trimImportValue(source.position, 160);
  if (!position) return null;
  return {
    position,
    startTime: trimImportValue(source.startTime, 40),
    endTime: trimImportValue(source.endTime, 40),
    workers: (Array.isArray(source.workers) ? source.workers : [])
      .slice(0, 500)
      .map(normalizeNowstaWorker)
      .filter(Boolean),
    unfilled: Math.max(0, Math.min(500, Math.round(Number(source.unfilled) || 0))),
  };
};

export const normalizeImportedMeta = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const nowstaSource = source.nowsta;
  const nowsta = nowstaSource && typeof nowstaSource === 'object' && !Array.isArray(nowstaSource)
    ? {
        department: trimImportValue(nowstaSource.department, 160),
        venue: trimImportValue(nowstaSource.venue, 300),
        address: trimImportValue(nowstaSource.address, 600),
        eventTime: trimImportValue(nowstaSource.eventTime, 100),
        uniform: trimImportValue(nowstaSource.uniform, 300),
        adminNotes: trimImportValue(nowstaSource.adminNotes, 2_000),
        staffTotals: trimImportValue(nowstaSource.staffTotals, 100),
        shifts: (Array.isArray(nowstaSource.shifts) ? nowstaSource.shifts : [])
          .slice(0, 500)
          .map(normalizeNowstaShift)
          .filter(Boolean),
      }
    : null;
  const rawGuestCount = source.guestCount;
  const guestCount = rawGuestCount === '' || rawGuestCount === null || rawGuestCount === undefined
    ? null
    : Number(rawGuestCount);
  return {
    venue: trimImportValue(source.venue ?? nowsta?.venue, 300),
    address: trimImportValue(source.address ?? nowsta?.address, 600),
    eventTime: trimImportValue(source.eventTime ?? nowsta?.eventTime, 100),
    guestCount: Number.isFinite(guestCount) && guestCount >= 0 ? Math.round(guestCount) : null,
    nowsta,
  };
};

export const normalizeImportedEvent = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const importSource = trimImportValue(source.importSource, 40).toLowerCase() === 'nowsta' ? 'nowsta' : 'caterease';
  const rawTitle = trimImportValue(source.title, 300);
  const title = importSource === 'nowsta'
    ? rawTitle.replace(/\s*[-–—]\s*staffing(?:\s+set\s*up|_?\s*\d+\s*pax)?\s*$/i, '').trim()
    : rawTitle;
  if (!title) return null;
  return {
    externalId: trimImportValue(source.externalId, 120),
    title,
    date: trimImportValue(source.date, 100),
    client: trimImportValue(source.client, 300),
    managerId: trimImportValue(source.managerId, 300),
    status: trimImportValue(source.status, 100).toLowerCase() || 'draft',
    importSource,
    meta: normalizeImportedMeta(source.meta),
  };
};

const ensureClientRecord = async (value) => {
  if (typeof value !== 'string') return;
  const name = value.trim();
  if (!name) return;
  const normalized = name.toLowerCase();
  try {
    await Client.updateOne(
      { normalized },
      { $setOnInsert: { name, normalized } },
      { upsert: true, runValidators: true }
    );
  } catch (error) {
    // Concurrent upserts may race on the unique normalized index. In that
    // case the desired client already exists and the event can proceed.
    if (error?.code !== 11000) throw error;
  }
};

const detachEventProposals = async (event, session = null) => {
  const options = session ? { session } : {};
  await Proposal.updateMany(
    {
      eventId: event._id,
      $or: [
        { eventTitle: '' },
        { eventTitle: null },
        { eventTitle: { $exists: false } },
      ],
    },
    { $set: { eventTitle: event.title || '' } },
    options
  );
  await Proposal.updateMany(
    { eventId: event._id },
    { $set: { eventId: null } },
    options
  );
};

const deleteEventRelations = async (event, session = null) => {
  const deckQuery = Deck.find({ eventId: event._id }).select('_id');
  if (session) deckQuery.session(session);
  const decks = await deckQuery.lean();
  const deckIds = decks.map((deck) => deck._id);
  const options = session ? { session } : {};

  if (deckIds.length) {
    await Page.deleteMany({ deckId: { $in: deckIds } }, options);
  }
  await Deck.deleteMany({ eventId: event._id }, options);
  await DecorPackout.deleteMany({ eventId: event._id }, options);
  await detachEventProposals(event, session);
};

const deleteEventInTransaction = async (eventId, session) => {
  const event = await Event.findById(eventId).session(session);
  if (!event) throw createHttpError(404, 'Not found');

  await deleteEventRelations(event, session);
  const deleted = await Event.deleteOne({ _id: event._id }, { session });
  if (!deleted?.deletedCount) throw createHttpError(404, 'Not found');
  return { cleanupPending: false };
};

const deleteEventWithoutTransaction = async (eventId) => {
  const event = await Event.findById(eventId);
  if (!event) throw createHttpError(404, 'Not found');

  const deleted = await Event.deleteOne({ _id: event._id });
  if (!deleted?.deletedCount) throw createHttpError(404, 'Not found');

  try {
    await deleteEventRelations(event);
    return { cleanupPending: false };
  } catch (error) {
    // The requested event is already gone. Report successful deletion while
    // making the partial cleanup visible to logs and the API response.
    console.error('Event relation cleanup failed:', error?.message || error);
    return { cleanupPending: true };
  }
};

// Create
router.post('/', async (req, res) => {
  try {
    const { externalId, title, date, client, managerId, status, meta } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    await ensureClientRecord(client);
    const doc = await Event.create({ externalId, title: String(title).trim(), date, client, managerId, status, meta });
    res.status(201).json(doc);
    clearCache();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Event creation failed',
      fallbackMessage: 'Failed to create event',
    });
  }
});

router.post('/import/preview', requireAdmin, async (req, res) => {
  try {
    const sourceRows = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!sourceRows.length) return res.status(400).json({ error: 'events array is required' });
    if (sourceRows.length > MAX_IMPORT_ROWS) {
      return res.status(413).json({ error: `Import preview is limited to ${MAX_IMPORT_ROWS} rows` });
    }

    const { uniqueRows, skipped } = prepareImportedRows(sourceRows);
    const rows = [];
    for (const { identity: _identity, ...event } of uniqueRows) {
      const target = await resolveImportedEventTarget(event);
      rows.push({
        action: target.action,
        eventId: String(target.matchedEvent?._id || ''),
        externalId: event.externalId,
        title: event.title,
        date: event.date,
        matchedTitle: target.matchedEvent?.title || '',
        matchedDate: target.matchedEvent?.date || '',
        message: target.conflict || (
          target.action === 'created' ? 'A new event will be created.'
            : target.action === 'event_id_assigned' ? 'Event ID will be assigned to the existing event.'
              : target.action === 'duplicates_merged' ? 'Existing duplicate import rows will be merged into the manual event.'
                : 'The existing event will be updated.'
        ),
        undoable: target.action !== 'duplicates_merged',
      });
    }

    return res.json({
      ok: true,
      totalRows: sourceRows.length,
      skipped,
      summary: summarizeImportOperations(rows),
      rows,
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event calendar preview failed',
      fallbackMessage: 'Failed to preview event calendar import',
    });
  }
});

router.get('/imports', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit) || 20));
    const runs = await ImportRun.find({ kind: 'event_calendar' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-operations.before -operations.after')
      .lean();
    return res.json(runs);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Import history load failed',
      fallbackMessage: 'Failed to load import history',
    });
  }
});

router.post('/imports/:runId/undo', requireAdmin, async (req, res) => {
  try {
    const run = await ImportRun.findOne({ _id: req.params.runId, kind: 'event_calendar' });
    if (!run) return res.status(404).json({ error: 'Import run not found' });
    if (run.status === 'undone') return res.status(409).json({ error: 'This import was already undone' });

    let undone = 0;
    let conflicts = 0;
    let skipped = 0;
    for (let index = run.operations.length - 1; index >= 0; index -= 1) {
      const operation = run.operations[index];
      if (!operation.undoable || !operation.eventId || ['failed', 'skipped'].includes(operation.action)) {
        operation.undoStatus = 'skipped';
        operation.undoMessage = operation.undoable ? 'No event change to undo.' : 'This row included a duplicate merge and cannot be safely undone.';
        skipped += 1;
        continue;
      }

      const current = await Event.findById(operation.eventId).lean();
      if (!current || !importedEventMatchesSnapshot(current, operation.after)) {
        operation.undoStatus = 'conflict';
        operation.undoMessage = current
          ? 'The event changed after this import and was left untouched.'
          : 'The event no longer exists.';
        conflicts += 1;
        continue;
      }

      if (operation.action === 'created') {
        const [deck, proposal, packout, barEvent] = await Promise.all([
          Deck.exists({ eventId: operation.eventId }),
          Proposal.exists({ eventId: operation.eventId }),
          DecorPackout.exists({ eventId: operation.eventId }),
          BarEvent.exists({ linkedEventId: operation.eventId }),
        ]);
        if (current.documents?.length || deck || proposal || packout || barEvent) {
          operation.undoStatus = 'conflict';
          operation.undoMessage = 'The new event already has documents or operational data and was left untouched.';
          conflicts += 1;
          continue;
        }
        await Event.updateOne(
          { _id: operation.eventId },
          {
            $set: {
              status: 'deleted',
              'meta.importUndo': {
                importRunId: String(run._id),
                undoneAt: new Date(),
              },
            },
            $unset: { externalId: 1 },
          }
        );
      } else {
        const before = operation.before || {};
        const setFields = {};
        const unsetFields = {};
        for (const field of ['externalId', 'title', 'date', 'client', 'managerId', 'status', 'importSource', 'meta']) {
          if (before[field] === undefined) unsetFields[field] = 1;
          else setFields[field] = before[field];
        }
        await Event.updateOne(
          { _id: operation.eventId },
          {
            ...(Object.keys(setFields).length ? { $set: setFields } : {}),
            ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
          },
          { runValidators: true }
        );
      }
      operation.undoStatus = 'undone';
      operation.undoMessage = 'Restored.';
      undone += 1;
    }

    run.status = conflicts || skipped ? 'partially_undone' : 'undone';
    run.undoneAt = new Date();
    run.undoneBy = trimImportValue(req.auth?.username || req.auth?.email, 180);
    run.markModified('operations');
    await run.save();
    clearRelatedCaches();
    return res.json({ ok: true, importRunId: String(run._id), status: run.status, undone, conflicts, skipped });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Import undo failed',
      fallbackMessage: 'Failed to undo event import',
    });
  }
});

router.get('/document-imports', requireRoles(['admin', 'super admin', 'bar admin']), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 30));
    const query = {};
    if (req.query?.eventId) query.eventId = req.query.eventId;
    const runs = await DocumentImportRun.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-beforeDocuments -afterDocuments -beforeBarEvent -afterBarEvent')
      .lean();
    return res.json(runs);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Document import history load failed',
      fallbackMessage: 'Failed to load document import history',
    });
  }
});

router.post('/document-imports/:runId/undo', requireRoles(['admin', 'super admin', 'bar admin']), async (req, res) => {
  try {
    const run = await DocumentImportRun.findById(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Document import not found' });
    if (run.status === 'undone') return res.status(409).json({ error: 'This document import was already undone' });

    const groupedRuns = run.batchId
      ? await DocumentImportRun.find({ eventId: run.eventId, batchId: run.batchId, status: 'applied' }).sort({ createdAt: 1 })
      : [run];
    if (!groupedRuns.length) return res.status(409).json({ error: 'This import package is no longer active' });
    const firstRun = groupedRuns[0];
    const lastRun = groupedRuns[groupedRuns.length - 1];

    const event = await Event.findById(run.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!eventDocumentsMatchSnapshot(event.documents, lastRun.afterDocuments)) {
      await DocumentImportRun.updateMany(
        { _id: { $in: groupedRuns.map((entry) => entry._id) } },
        { $set: { status: 'conflict', undoMessage: 'Event documents changed after this import and were left untouched.' } }
      );
      return res.status(409).json({ error: 'Event documents changed after this import and were left untouched.', status: 'conflict' });
    }

    const before = snapshotEventDocuments(firstRun.beforeDocuments);
    const beforeIds = new Set(before.map((document) => String(document?._id || '')).filter(Boolean));
    const current = snapshotEventDocuments(event.documents);
    const displaced = current.filter((document) => !beforeIds.has(String(document?._id || '')));

    const barSnapshotRun = [...groupedRuns].reverse().find((entry) => entry.afterBarEvent) || null;
    let barEvent = null;
    if (barSnapshotRun) {
      barEvent = await BarEvent.findOne({ linkedEventId: event._id });
      if (!barEvent || !barDocumentImportMatchesSnapshot(barEvent, barSnapshotRun.afterBarEvent)) {
        await DocumentImportRun.updateMany(
          { _id: { $in: groupedRuns.map((entry) => entry._id) } },
          { $set: { status: 'conflict', undoMessage: 'Bar event changed after this import and was left untouched.' } }
        );
        return res.status(409).json({ error: 'Bar event changed after this import and was left untouched.', status: 'conflict' });
      }
    }

    event.documentHistory = mergeEventDocumentHistory(
      (event.documentHistory || []).filter((document) => !beforeIds.has(String(document?._id || ''))),
      displaced
    );
    event.documents = before;
    await event.save();

    if (barEvent && barSnapshotRun?.beforeBarEvent) {
      applyBarDocumentImportSnapshot(barEvent, barSnapshotRun.beforeBarEvent);
      if (Array.isArray(barEvent.audit)) {
        barEvent.audit.push({
          action: 'document_import_undone',
          details: { batchId: run.batchId || String(run._id) },
        });
      }
      await barEvent.save();
    }

    const undoneAt = new Date();
    const undoneBy = trimImportValue(req.auth?.username || req.auth?.email, 180);
    await DocumentImportRun.updateMany(
      { _id: { $in: groupedRuns.map((entry) => entry._id) } },
      { $set: { status: 'undone', undoneAt, undoneBy, undoMessage: 'Previous documents and imported bar data restored.' } }
    );
    clearRelatedCaches();
    return res.json({
      ok: true,
      status: 'undone',
      event,
      importRunId: String(run._id),
      undoneDocuments: groupedRuns.length,
      barEventRestored: Boolean(barEvent),
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Document import undo failed',
      fallbackMessage: 'Failed to undo document import',
    });
  }
});

router.post('/import', requireAdmin, async (req, res) => {
  try {
    const sourceRows = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!sourceRows.length) return res.status(400).json({ error: 'events array is required' });
    if (sourceRows.length > MAX_IMPORT_ROWS) {
      return res.status(413).json({ error: `Import is limited to ${MAX_IMPORT_ROWS} rows` });
    }

    const { normalizedRows, uniqueRows } = prepareImportedRows(sourceRows);

    const clientNames = [...new Set(uniqueRows.map((event) => event.client).filter(Boolean))];
    for (const client of clientNames) await ensureClientRecord(client);

    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      eventIdsAssigned: 0,
      duplicatesMerged: 0,
      failed: 0,
      skipped: sourceRows.length - normalizedRows.length,
    };
    const failures = [];
    const operations = [];
    for (const { identity: _identity, meta, ...event } of uniqueRows) {
      try {
        const target = await resolveImportedEventTarget(event);
        if (target.conflict) {
          stats.skipped += 1;
          operations.push({
            action: 'skipped',
            externalId: event.externalId,
            title: event.title,
            date: event.date,
            message: target.conflict,
            undoable: false,
          });
          continue;
        }
        const { filter, assigningEventId, duplicateEventIds } = target;
        const before = target.matchedEvent ? snapshotImportedEvent(target.matchedEvent) : null;
        const setFields = { ...event };
        const deferredIdentity = duplicateEventIds.length
          ? { externalId: event.externalId, importSource: event.importSource }
          : null;
        if (deferredIdentity) {
          delete setFields.externalId;
          delete setFields.importSource;
        }
        if (meta?.nowsta) {
          setFields['meta.nowsta'] = meta.nowsta;
          setFields['meta.venue'] = meta.venue;
          setFields['meta.address'] = meta.address;
          setFields['meta.eventTime'] = meta.eventTime;
          if (meta.guestCount !== null) setFields['meta.guestCount'] = meta.guestCount;
        }
        const result = await Event.updateOne(
          filter,
          {
            $set: setFields,
          },
          { upsert: true, runValidators: true }
        );
        if (duplicateEventIds.length && result.matchedCount) {
          const targetEventId = filter._id;
          for (const duplicateEventId of duplicateEventIds) {
            await runWithTransactionFallback(
              (session) => mergeImportedDuplicateIntoManualEvent(duplicateEventId, targetEventId, session),
              () => mergeImportedDuplicateIntoManualEvent(duplicateEventId, targetEventId)
            );
            stats.duplicatesMerged += 1;
          }
          await Event.updateOne(
            { _id: targetEventId },
            { $set: deferredIdentity },
            { runValidators: true }
          );
        }
        stats.processed += 1;
        let action = target.action;
        if (result.upsertedCount) {
          stats.created += 1;
          action = 'created';
        }
        else if (result.matchedCount) {
          stats.updated += 1;
          if (assigningEventId) stats.eventIdsAssigned += 1;
          if (action === 'created') action = 'updated';
        }
        const targetEventId = result.upsertedId || filter._id;
        const savedEvent = targetEventId
          ? await Event.findById(targetEventId).lean()
          : await Event.findOne(filter).lean();
        operations.push({
          action,
          eventId: savedEvent?._id || targetEventId || null,
          externalId: event.externalId,
          title: event.title,
          date: event.date,
          message: action === 'created' ? 'Event created.'
            : action === 'event_id_assigned' ? 'Event ID assigned to existing event.'
              : action === 'duplicates_merged' ? `${duplicateEventIds.length} duplicate event${duplicateEventIds.length === 1 ? '' : 's'} merged.`
                : 'Existing event updated.',
          before,
          after: savedEvent ? snapshotImportedEvent(savedEvent) : null,
          undoable: action !== 'duplicates_merged',
        });
      } catch (rowError) {
        stats.failed += 1;
        failures.push({
          externalId: event.externalId,
          title: event.title,
          date: event.date,
          error: importedEventFailureMessage(rowError),
        });
        operations.push({
          action: 'failed',
          externalId: event.externalId,
          title: event.title,
          date: event.date,
          message: importedEventFailureMessage(rowError),
          undoable: false,
        });
        console.error('Event calendar row import failed', {
          externalId: event.externalId,
          title: event.title,
          date: event.date,
          error: rowError,
        });
      }
    }
    stats.skipped += normalizedRows.length - uniqueRows.length;

    const runMetadata = {
      source: trimImportValue(req.body?.source, 80),
      fileName: trimImportValue(req.body?.fileName, 300),
      createdBy: trimImportValue(req.auth?.username || req.auth?.email, 180),
      createdById: trimImportValue(req.auth?.userId, 120),
    };
    let importRun = null;
    if (req.body?.importRunId) {
      importRun = await ImportRun.findOne({
        _id: req.body.importRunId,
        kind: 'event_calendar',
        status: 'applied',
      });
      if (!importRun) return res.status(409).json({ error: 'The import run can no longer accept additional rows' });
      importRun.operations.push(...operations);
      const previousSummary = importRun.summary || {};
      importRun.summary = {
        totalRows: (Number(previousSummary.totalRows) || 0) + sourceRows.length,
        ...Object.fromEntries(Object.keys(stats).map((field) => [
          field,
          (Number(previousSummary[field]) || 0) + (Number(stats[field]) || 0),
        ])),
      };
      if (!importRun.fileName && runMetadata.fileName) importRun.fileName = runMetadata.fileName;
      if (!importRun.source && runMetadata.source) importRun.source = runMetadata.source;
      await importRun.save();
    } else {
      importRun = await ImportRun.create({
        kind: 'event_calendar',
        ...runMetadata,
        summary: { totalRows: sourceRows.length, ...stats },
        operations,
      });
    }

    clearRelatedCaches();
    return res.json({
      ok: true,
      totalRows: sourceRows.length,
      stats,
      failures,
      importRunId: String(importRun._id),
      rows: operations.map(({ before: _before, after: _after, ...operation }) => operation),
    });
  } catch (e) {
    return sendApiError(res, e, {
      context: 'Event calendar import failed',
      fallbackMessage: 'Failed to import event calendar',
    });
  }
});

// List (optionally by manager)
router.get('/', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const q = { status: { $not: /^deleted$/i } };
    if (req.query.managerId) q.managerId = req.query.managerId;
    if (String(req.query.calendar || '') === '1') {
      const from = trimImportValue(req.query.from, 10);
      const to = trimImportValue(req.query.to, 10);
      const validDate = /^\d{4}-\d{2}-\d{2}$/;
      if (!validDate.test(from) || !validDate.test(to) || from > to) {
        return res.status(400).json({ error: 'Valid calendar from and to dates are required' });
      }

      const [items, undated, monthCountRows] = await Promise.all([
        Event.find({ ...q, date: { $gte: from, $lte: to } })
          .select('-documentHistory')
          .sort({ date: 1, title: 1 })
          .lean(),
        Event.find({
          ...q,
          $or: [
            { date: { $exists: false } },
            { date: null },
            { date: '' },
          ],
        })
          .select('-documentHistory')
          .sort({ createdAt: -1 })
          .lean(),
        Event.aggregate([
          { $match: { ...q, date: { $regex: /^\d{4}-\d{2}-\d{2}/ } } },
          { $group: { _id: { $substrBytes: ['$date', 0, 7] }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
      ]);

      return res.json({
        items,
        undated,
        monthCounts: Object.fromEntries(monthCountRows.map((row) => [row._id, row.count])),
        range: { from, to },
      });
    }
    const items = await Event.find(q).select('-documentHistory').sort({ createdAt: -1 });
    res.json(items);
  } catch (e) {
    sendApiError(res, e, {
      context: 'Events list failed',
      fallbackMessage: 'Failed to list events',
    });
  }
});

// Save the latest source PO or Kitchen Menu on the dashboard event.
// Re-uploading the same type replaces the current file and increments its version.
router.post(
  '/:id/documents',
  requireRoles(['admin', 'super admin', 'bar admin']),
  eventDocumentUpload.single('file'),
  async (req, res) => {
  let stored = null;
  let eventSaved = false;
  try {
    if (!req.file) return res.status(400).json({ error: 'DOCX file is required' });
    if (!isDocxUpload(req.file)) return res.status(400).json({ error: 'Only a valid DOCX file can be uploaded' });
    const type = normalizeEventDocumentType(req.body?.type);
    if (!type) return res.status(400).json({ error: 'Document type must be po or kitchen_menu' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const batchId = trimImportValue(req.body?.importBatchId, 120) || crypto.randomUUID();
    const existing = (event.documents || []).find((document) => String(document.type) === type) || null;
    if (existing && String(existing.checksum || '') === checksum) {
      const documents = snapshotEventDocuments(event.documents);
      const run = await DocumentImportRun.create({
        eventId: event._id,
        eventTitle: event.title,
        batchId,
        documentType: type,
        action: 'reprocessed',
        fileName: existing.fileName,
        version: existing.version || 1,
        checksum,
        beforeDocuments: documents,
        afterDocuments: documents,
        createdBy: trimImportValue(req.auth?.username || req.auth?.email, 180),
        createdById: trimImportValue(req.auth?.id || req.auth?._id, 120),
      });
      return res.json({ event, document: existing, unchanged: true, action: 'reprocessed', importRunId: String(run._id) });
    }

    const beforeDocuments = snapshotEventDocuments(event.documents);
    const sameFileWrongType = (event.documents || []).find((document) => (
      String(document.type) !== type && String(document.checksum || '') === checksum
    )) || null;
    const version = nextEventDocumentVersion(type, event.documents, event.documentHistory);
    if (sameFileWrongType) {
      stored = { url: sameFileWrongType.url, publicId: sameFileWrongType.publicId || '', reused: true };
    } else {
      stored = await storeEventDocument(req.file, String(event._id), type, version);
    }
    if (!stored?.url) throw new Error('Document storage did not return a download URL');
    const nextDocument = {
      type,
      fileName: trimImportValue(req.file.originalname, 240) || `${type}.docx`,
      contentType: trimImportValue(req.file.mimetype, 120),
      size: req.file.size,
      checksum,
      url: stored.url,
      publicId: stored.publicId,
      version,
      uploadedAt: new Date(),
      uploadedBy: trimImportValue(req.auth?.username || req.auth?.email, 240),
      kitchenItems: type === 'kitchen_menu' ? parseKitchenDocumentItems(req.body?.kitchenItems) : undefined,
    };
    const replacedDocuments = (event.documents || []).filter((document) => (
      String(document.type) === type
      || (sameFileWrongType && String(document._id) === String(sameFileWrongType._id))
    ));
    event.documentHistory = mergeEventDocumentHistory(event.documentHistory, replacedDocuments);
    event.documents = [
      ...(event.documents || []).filter((document) => (
        String(document.type) !== type
        && (!sameFileWrongType || String(document._id) !== String(sameFileWrongType._id))
      )),
      nextDocument,
    ];
    await event.save();
    eventSaved = true;
    clearRelatedCaches();
    const saved = event.documents.find((document) => String(document.type) === type);
    const action = sameFileWrongType ? 'corrected_type' : (existing ? 'replaced' : 'uploaded');
    const run = await DocumentImportRun.create({
      eventId: event._id,
      eventTitle: event.title,
      batchId,
      documentType: type,
      action,
      fileName: saved?.fileName || nextDocument.fileName,
      version,
      checksum,
      beforeDocuments,
      afterDocuments: snapshotEventDocuments(event.documents),
      createdBy: trimImportValue(req.auth?.username || req.auth?.email, 180),
      createdById: trimImportValue(req.auth?.id || req.auth?._id, 120),
    });
    return res.status(existing || sameFileWrongType ? 200 : 201).json({
      event,
      document: saved,
      unchanged: false,
      action,
      correctedFromType: sameFileWrongType?.type || '',
      importRunId: String(run._id),
    });
  } catch (error) {
    if (!eventSaved && stored?.url && !stored?.reused) await cleanupEventDocument(stored);
    return sendApiError(res, error, {
      context: 'Event document upload failed',
      fallbackMessage: 'Failed to save event document',
    });
  }
  }
);

// Get by id
router.get('/:id', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const doc = await Event.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    sendApiError(res, e, {
      context: 'Event lookup failed',
      fallbackMessage: 'Failed to load event',
    });
  }
});

// Patch
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['externalId','title','date','client','managerId','status','meta'].forEach(k => {
      if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k];
    });
    if (updates.title) updates.title = String(updates.title).trim();
    if (typeof updates.client === 'string') await ensureClientRecord(updates.client);
    const doc = await Event.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
    clearCache();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Event update failed',
      fallbackMessage: 'Failed to update event',
    });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    const result = await runWithTransactionFallback(
      (session) => deleteEventInTransaction(req.params.id, session),
      () => deleteEventWithoutTransaction(req.params.id)
    );
    res.json({ ok: true, cleanupPending: Boolean(result?.cleanupPending) });
    clearRelatedCaches();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Event deletion failed',
      fallbackMessage: 'Failed to delete event',
    });
  }
});

export default router;
