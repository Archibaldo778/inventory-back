import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import KitchenItem from '../models/KitchenItem.js';

const router = Router();

// Ensure uploads directory exists (Render fs is ephemeral but writable during runtime)
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) { /* ignore */ }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|webp/.test((file.mimetype || '').toLowerCase());
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

// GET all kitchen items
router.get('/', async (_req, res) => {
  try {
    const items = await KitchenItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, description = '', dietary } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    let dietaryArr = [];
    if (dietary) {
      try { dietaryArr = JSON.parse(dietary); } catch { dietaryArr = []; }
      if (!Array.isArray(dietaryArr)) dietaryArr = [];
    }
    const payload = {
      name: name.trim(),
      description: (description || '').trim(),
      dietary: dietaryArr,
      image: req.file ? `/uploads/${req.file.filename}` : null,
    };
    const created = await KitchenItem.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE
router.patch('/:id', upload.single('image'), async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.description !== undefined) updates.description = String(req.body.description || '').trim();
    if (req.body.dietary !== undefined) {
      try {
        const arr = JSON.parse(req.body.dietary);
        updates.dietary = Array.isArray(arr) ? arr : [];
      } catch {
        updates.dietary = [];
      }
    }
    if (req.file) updates.image = `/uploads/${req.file.filename}`;

    const updated = await KitchenItem.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await KitchenItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
