import { Router } from 'express';
import apicache from 'apicache';
import Client from '../models/Client.js';
import Event from '../models/Event.js';

const router = Router();

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clearRelatedCaches = () => {
  try { apicache.clear('events'); } catch { /* ignore */ }
};

router.get('/', async (req, res) => {
  try {
    let items = await Client.find({}).sort({ name: 1 });
    const normalizedSet = new Set(
      (items || [])
        .map((client) => client?.normalized || String(client?.name || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const distinct = await Event.distinct('client', { client: { $type: 'string', $ne: '' } });
    const toInsert = [];
    (distinct || []).forEach((raw) => {
      const trimmed = String(raw || '').trim();
      if (!trimmed) return;
      const norm = trimmed.toLowerCase();
      if (normalizedSet.has(norm)) return;
      normalizedSet.add(norm);
      toInsert.push({ name: trimmed, normalized: norm });
    });
    if (toInsert.length) {
      try {
        await Client.insertMany(toInsert, { ordered: false });
      } catch {
        /* ignore insert conflicts */
      }
      items = await Client.find({}).sort({ name: 1 });
    }
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const raw = req.body?.name;
    if (!raw || !String(raw).trim()) return res.status(400).json({ error: 'name is required' });
    const name = String(raw).trim();
    const normalized = name.toLowerCase();
    const existing = await Client.findOne({ normalized });
    if (existing) return res.json(existing);
    const doc = await Client.create({ name, normalized });
    res.status(201).json(doc);
    clearRelatedCaches();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const raw = req.body?.name;
    if (!raw || !String(raw).trim()) return res.status(400).json({ error: 'name is required' });
    const name = String(raw).trim();
    const normalized = name.toLowerCase();
    const existing = await Client.findOne({ normalized });
    if (existing && String(existing._id) !== String(req.params.id)) {
      return res.status(409).json({ error: 'Client already exists' });
    }
    const current = await Client.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });
    const oldName = current.name || '';
    current.name = name;
    current.normalized = normalized;
    await current.save();
    if (oldName && oldName.trim() && oldName.trim() !== name) {
      const pattern = `^${escapeRegex(oldName.trim())}$`;
      await Event.updateMany({ client: { $regex: pattern, $options: 'i' } }, { $set: { client: name } });
    }
    res.json(current);
    clearRelatedCaches();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Client.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    clearRelatedCaches();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
