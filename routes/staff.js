import { Router } from 'express';
import Staff from '../models/Staff.js';

const router = Router();

// List with optional filters: ?q= & positions=Waiter,Bartender & active=true
router.get('/', async (req, res) => {
  try {
    const { q, positions, active } = req.query || {};
    const filter = {};
    if (typeof active !== 'undefined') filter.active = String(active) === 'true';
    if (q) {
      const re = new RegExp(String(q).trim(), 'i');
      filter.$or = [ { firstName: re }, { lastName: re } ];
    }
    if (positions) {
      const list = String(positions).split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) filter.positions = { $in: list };
    }
    const items = await Staff.find(filter).sort({ createdAt: -1 });
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Failed to list staff' });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    const { firstName, lastName, photo = '', positions = [], note = '', active = true } = req.body || {};
    if (!firstName || !lastName) return res.status(400).json({ message: 'firstName and lastName are required' });
    const doc = await Staff.create({ firstName, lastName, photo, positions, note, active });
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create staff' });
  }
});

// Get by id
router.get('/:id', async (req, res) => {
  try {
    const doc = await Staff.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to get staff' });
  }
});

// Patch
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['firstName','lastName','photo','positions','note','active'].forEach(k => {
      if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k];
    });
    const doc = await Staff.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update staff' });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    await Staff.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to delete staff' });
  }
});

export default router;

