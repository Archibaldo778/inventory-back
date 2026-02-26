import { Router } from 'express';
import apicache from 'apicache';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'decks';
const cacheWithGroup = (duration, group) => {
  const middleware = cache(duration);
  return (req, res, next) => {
    res.apicacheGroup = group;
    return middleware(req, res, next);
  };
};

const clearCache = () => {
  apicache.clear(CACHE_GROUP);
  apicache.clear('pages');
};

const areEqualJson = (left, right) => {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

// Create deck
router.post('/', async (req, res) => {
  try {
    const { eventId, type = 'decor', title } = req.body || {};
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
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

    const bulkOps = [];
    const sanitizedPages = pages.map((pageDoc) => {
      const page = pageDoc.toObject();
      const nextCanvas = sanitizeBoardCanvas(page.canvas);
      if (!areEqualJson(page.canvas, nextCanvas)) {
        bulkOps.push({
          updateOne: {
            filter: { _id: pageDoc._id },
            update: { $set: { canvas: nextCanvas } },
          },
        });
      }
      return {
        ...page,
        canvas: nextCanvas,
      };
    });

    if (bulkOps.length > 0) {
      await Page.bulkWrite(bulkOps).catch(() => {});
      clearCache();
    }

    res.json({ ...deck.toObject(), pages: sanitizedPages });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Patch deck
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['title', 'type'].forEach((k) => { if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k]; });
    const deck = await Deck.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!deck) return res.status(404).json({ error: 'Not found' });
    res.json(deck);
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
