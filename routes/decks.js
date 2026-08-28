import { Router } from 'express';
import Deck from '../models/Deck.js';
import Event from '../models/Event.js';
import Page from '../models/Page.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';
import { clearApiCacheGroups, createGroupedApiCache } from '../utils/apiCache.js';
import { sendApiError } from '../utils/apiErrors.js';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';

const router = Router();
const CACHE_GROUP = 'decks';
const cacheWithGroup = createGroupedApiCache;

const clearCache = () => clearApiCacheGroups(CACHE_GROUP, 'pages');

const normalizeObjectId = (value) => {
  const raw = String(value || '').trim();
  return raw && /^[a-f\d]{24}$/i.test(raw) ? raw : '';
};

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const deleteDeckInTransaction = async (deckId, session) => {
  const deck = await Deck.findById(deckId).session(session);
  if (!deck) throw createHttpError(404, 'Not found');

  const siblingCount = await Deck.countDocuments({
    eventId: deck.eventId,
    type: deck.type,
  }).session(session);
  if (siblingCount <= 1) {
    throw createHttpError(409, 'At least one deck must remain');
  }

  // Every delete for the same event writes this shared document. That turns
  // concurrent "last deck" checks into a write conflict which Mongo retries.
  await Event.updateOne(
    { _id: deck.eventId },
    { $inc: { deckRevision: 1 } },
    { session }
  );
  await Page.deleteMany({ deckId: deck._id }).session(session);
  await Deck.deleteOne({ _id: deck._id }).session(session);
};

const deleteDeckWithoutTransaction = async (deckId) => {
  const deck = await Deck.findById(deckId);
  if (!deck) throw createHttpError(404, 'Not found');

  const siblingCount = await Deck.countDocuments({ eventId: deck.eventId, type: deck.type });
  if (siblingCount <= 1) {
    throw createHttpError(409, 'At least one deck must remain');
  }

  // Standalone Mongo does not support transactions. Remove the deck first so
  // a cleanup failure can only leave orphan pages, never a visible empty deck.
  const deleted = await Deck.deleteOne({ _id: deck._id });
  if (!deleted?.deletedCount) throw createHttpError(404, 'Not found');
  await Page.deleteMany({ deckId: deck._id });
};

// Create deck
router.post('/', async (req, res) => {
  try {
    const { eventId, type = 'decor', title } = req.body || {};
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const eventExists = await Event.exists({ _id: eventId });
    if (!eventExists) return res.status(404).json({ error: 'Event not found' });
    const deck = await Deck.create({ eventId, type, title });
    res.status(201).json(deck);
    clearCache();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Deck creation failed',
      fallbackMessage: 'Failed to create deck',
    });
  }
});

// List decks (by eventId/type if provided)
router.get('/', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const q = {};
    if (req.query.eventId) q.eventId = req.query.eventId;
    if (req.query.type) q.type = req.query.type;
    const decks = await Deck.find(q).sort({ createdAt: -1 });
    res.json(decks);
  } catch (e) {
    sendApiError(res, e, {
      context: 'Decks list failed',
      fallbackMessage: 'Failed to list decks',
    });
  }
});

// Lightweight data for the event overview. Never include canvas or previews here:
// those fields can be megabytes and the overview only needs counts and labels.
router.get('/summaries/event/:eventId', async (req, res) => {
  try {
    const eventId = normalizeObjectId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'Invalid eventId' });

    const decks = await Deck.find({ eventId })
      .select('_id eventId type title createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    const deckIds = decks.map((deck) => deck._id);
    const pageCounts = deckIds.length
      ? await Page.aggregate([
          { $match: { deckId: { $in: deckIds }, deletedAt: null } },
          { $group: { _id: '$deckId', pageCount: { $sum: 1 } } },
        ])
      : [];
    const countByDeckId = new Map(pageCounts.map((row) => [String(row._id), Number(row.pageCount) || 0]));

    return res.json(decks.map((deck) => ({
      ...deck,
      pageCount: countByDeckId.get(String(deck._id)) || 0,
    })));
  } catch (e) {
    return sendApiError(res, e, {
      context: 'Deck summaries lookup failed',
      fallbackMessage: 'Failed to load deck summaries',
    });
  }
});

// Poll this endpoint instead of downloading every canvas and base64 preview.
// The client fetches a full deck only after metadata proves that a remote page changed.
router.get('/:id/sync-state', async (req, res) => {
  try {
    const deck = await Deck.findById(req.params.id).select('_id updatedAt').lean();
    if (!deck) return res.status(404).json({ error: 'Not found' });
    const pages = await Page.find({ deckId: deck._id, deletedAt: null })
      .select('_id index revision updatedAt canvas.meta')
      .sort({ index: 1, createdAt: 1 })
      .lean();
    return res.json({
      _id: deck._id,
      updatedAt: deck.updatedAt,
      pages: pages.map((page) => ({
        _id: page._id,
        index: page.index,
        revision: page.revision,
        updatedAt: page.updatedAt,
        meta: page.canvas?.meta || {},
      })),
    });
  } catch (e) {
    return sendApiError(res, e, {
      context: 'Deck sync state lookup failed',
      fallbackMessage: 'Failed to load deck sync state',
    });
  }
});

// Get deck with pages
router.get('/:id', async (req, res) => {
  try {
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Not found' });
    const pages = await Page.find({ deckId: deck._id, deletedAt: null }).sort({ index: 1, createdAt: 1 });

    const sanitizedPages = pages.map((pageDoc) => {
      const page = pageDoc.toObject();
      const nextCanvas = sanitizeBoardCanvas(page.canvas);
      return {
        ...page,
        canvas: nextCanvas,
      };
    });

    res.json({ ...deck.toObject(), pages: sanitizedPages });
  } catch (e) {
    sendApiError(res, e, {
      context: 'Deck lookup failed',
      fallbackMessage: 'Failed to load deck',
    });
  }
});

// Patch deck
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['title', 'type'].forEach((k) => { if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k]; });
    const deck = await Deck.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!deck) return res.status(404).json({ error: 'Not found' });
    res.json(deck);
    clearCache();
  } catch (e) {
    sendApiError(res, e, {
      context: 'Deck update failed',
      fallbackMessage: 'Failed to update deck',
    });
  }
});

// Delete deck with all pages
router.delete('/:id', async (req, res) => {
  try {
    await runWithTransactionFallback(
      (session) => deleteDeckInTransaction(req.params.id, session),
      () => deleteDeckWithoutTransaction(req.params.id)
    );

    clearCache();
    res.json({ ok: true });
  } catch (e) {
    sendApiError(res, e, {
      context: 'Deck deletion failed',
      fallbackMessage: 'Failed to delete deck',
    });
  }
});

export default router;
