import { Router } from 'express';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import Proposal from '../models/Proposal.js';
import Client from '../models/Client.js';
import DecorPackout from '../models/DecorPackout.js';
import { requireAdmin } from '../middleware/auth.js';
import { clearApiCacheGroups, createGroupedApiCache } from '../utils/apiCache.js';
import { sendApiError } from '../utils/apiErrors.js';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';

const router = Router();
const CACHE_GROUP = 'events';
const cacheWithGroup = createGroupedApiCache;

const clearCache = () => clearApiCacheGroups(CACHE_GROUP);
const clearRelatedCaches = () => {
  clearApiCacheGroups(CACHE_GROUP, 'decks', 'pages');
};

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const MAX_IMPORT_ROWS = 2_000;
const trimImportValue = (value, maxLength = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

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
  const title = trimImportValue(source.title, 300);
  if (!title) return null;
  return {
    externalId: trimImportValue(source.externalId, 120),
    title,
    date: trimImportValue(source.date, 100),
    client: trimImportValue(source.client, 300),
    managerId: trimImportValue(source.managerId, 300),
    status: trimImportValue(source.status, 100).toLowerCase() || 'draft',
    importSource: trimImportValue(source.importSource, 40).toLowerCase() === 'nowsta' ? 'nowsta' : 'caterease',
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
    const { title, date, client, managerId, status, meta } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    await ensureClientRecord(client);
    const doc = await Event.create({ title: String(title).trim(), date, client, managerId, status, meta });
    res.status(201).json(doc);
    clearCache();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Event creation failed',
      fallbackMessage: 'Failed to create event',
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

    const clientNames = [...new Set(uniqueRows.map((event) => event.client).filter(Boolean))];
    for (const client of clientNames) await ensureClientRecord(client);

    const stats = { processed: 0, created: 0, updated: 0, skipped: sourceRows.length - normalizedRows.length };
    for (const { identity: _identity, meta, ...event } of uniqueRows) {
      const filter = event.externalId
        ? { externalId: event.externalId }
        : {
            title: event.title,
            date: event.date,
            client: event.client,
            managerId: event.managerId,
          };
      const setFields = { ...event };
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
      stats.processed += 1;
      if (result.upsertedCount) stats.created += 1;
      else if (result.matchedCount) stats.updated += 1;
    }
    stats.skipped += normalizedRows.length - uniqueRows.length;

    clearRelatedCaches();
    return res.json({
      ok: true,
      totalRows: sourceRows.length,
      stats,
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
    const q = {};
    if (req.query.managerId) q.managerId = req.query.managerId;
    const items = await Event.find(q).sort({ createdAt: -1 });
    res.json(items);
  } catch (e) {
    sendApiError(res, e, {
      context: 'Events list failed',
      fallbackMessage: 'Failed to list events',
    });
  }
});

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
    ['title','date','client','managerId','status','meta'].forEach(k => {
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
