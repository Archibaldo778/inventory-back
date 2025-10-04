import { Router } from 'express';
import apicache from 'apicache';
import Page from '../models/Page.js';

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'pages';
const cacheWithGroup = (duration, group) => {
  const middleware = cache(duration);
  return (req, res, next) => {
    res.apicacheGroup = group;
    return middleware(req, res, next);
  };
};
const clearCache = () => {
  apicache.clear(CACHE_GROUP);
  apicache.clear('decks');
};

// Create page
router.post('/', async (req, res) => {
  try {
    const { deckId, index = 0, canvas = {}, preview = '' } = req.body || {};
    if (!deckId) return res.status(400).json({ error: 'deckId is required' });
    const page = await Page.create({ deckId, index, canvas, preview });
    res.status(201).json(page);
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get page
router.get('/:id', cacheWithGroup('2 minutes', CACHE_GROUP), async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) return res.status(404).json({ error: 'Not found' });
    res.json(page);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update page (canvas/preview/index)
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['index','canvas','preview'].forEach(k => { if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k]; });
    const page = await Page.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!page) return res.status(404).json({ error: 'Not found' });
    res.json(page);
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete page
router.delete('/:id', async (req, res) => {
  try {
    await Page.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
