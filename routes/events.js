import { Router } from 'express';
import apicache from 'apicache';
import Event from '../models/Event.js';

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'events';

const clearCache = () => apicache.clear(CACHE_GROUP);

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
router.get('/', cache('5 minutes', CACHE_GROUP), async (req, res) => {
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
router.get('/:id', cache('5 minutes', CACHE_GROUP), async (req, res) => {
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
    const doc = await Event.findByIdAndUpdate(req.params.id, updates, { new: true });
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
    const doc = await Event.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    clearCache();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
