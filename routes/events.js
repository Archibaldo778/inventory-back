import { Router } from 'express';
import apicache from 'apicache';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import Proposal from '../models/Proposal.js';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'events';
const cacheWithGroup = (duration, group) => {
  const middleware = cache(duration);
  return (req, res, next) => {
    req.apicacheGroup = group;
    return middleware(req, res, next);
  };
};

const clearCache = () => apicache.clear(CACHE_GROUP);
const clearRelatedCaches = () => {
  clearCache();
  apicache.clear('decks');
  apicache.clear('pages');
};

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

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
    const doc = await Event.create({ title: String(title).trim(), date, client, managerId, status, meta });
    res.status(201).json(doc);
    clearCache();
  } catch (e) {
    res.status(400).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// Get by id
router.get('/:id', cacheWithGroup('5 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const doc = await Event.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
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
    const doc = await Event.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
    clearCache();
  } catch (e) {
    res.status(400).json({ error: e.message });
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
    const statusCode = Number(e?.statusCode) === 404 ? 404 : 400;
    res.status(statusCode).json({ error: e.message });
  }
});

export default router;
