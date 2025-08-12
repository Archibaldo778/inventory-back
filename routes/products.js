import { Router } from 'express';
import Product from '../models/Product.js';

const router = Router();

// CREATE
router.post('/', async (req, res) => {
  try {
    const doc = await Product.create(req.body);
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ all
router.get('/', async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.patch('/:id', async (req, res) => {
  try {
    const doc = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;