import { Router } from 'express';
import apicache from 'apicache';
import Deck from '../models/Deck.js';
import Event from '../models/Event.js';
import Page from '../models/Page.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'decks';
const cacheWithGroup = (duration, group) => {
  const middleware = cache(duration);
  return (req, res, next) => {
    req.apicacheGroup = group;
    return middleware(req, res, next);
  };
};

const clearCache = () => {
  apicache.clear(CACHE_GROUP);
  apicache.clear('pages');
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
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// List decks (by eventId/type if provided)
router.get('/', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const q = {};
    if (req.query.eventId) q.eventId = req.query.eventId;
    if (req.query.type) q.type = req.query.type;
    const decks = await Deck.find(q).sort({ createdAt: -1 });
    res.json(decks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get deck with pages
router.get('/:id', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const deck = await Deck.findById(req.params.id);
    if (!deck) return res.status(404).json({ error: 'Not found' });
    const pages = await Page.find({ deckId: deck._id }).sort({ index: 1, createdAt: 1 });

    const sanitizedPages = pages.map((pageDoc) => {
      const page = pageDoc.toObject();
      const nextCanvas = sanitizeBoardCanvas(page.canvas);
      return {
        ...page,
        canvas: nextCanvas,
      };
    });

    res.json({ ...deck.toObject(), pages: sanitizedPages });
  } catch (e) { res.status(400).json({ error: e.message }); }
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
  } catch (e) { res.status(400).json({ error: e.message }); }
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
    const statusCode = [404, 409].includes(Number(e?.statusCode)) ? Number(e.statusCode) : 400;
    res.status(statusCode).json({ error: e.message });
  }
});

export default router;
