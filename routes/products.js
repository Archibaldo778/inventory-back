import multer from 'multer';
import path from 'path';
import { Router } from 'express';
import Product from '../models/Product.js';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|webp/.test(file.mimetype.toLowerCase());
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

// CREATE
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, qty, quantity, supplier, location, category, material, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const qtyNum = Number((quantity ?? qty) ?? 0);
    let image = null;
    if (req.file) {
      try {
        image = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'inventory' },
            (error, result) => {
              if (error) return reject(error);
              resolve(result.secure_url);
            }
          );
          stream.end(req.file.buffer);
        });
      } catch (err) {
        console.error('Cloudinary upload failed:', err);
      }
    }

    const doc = await Product.create({
      name: name.trim(),
      quantity: Number.isFinite(qtyNum) ? qtyNum : 0,
      supplier: supplier || '',
      location: location || '',
      category: category || 'Trays',
      material: material || '',
      color: color || '',
      image,
    });

    // Backwards-compat alias
    const out = doc.toObject();
    out.qty = out.quantity;
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ all
router.get('/', async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 });
    const mapped = items.map((d) => ({ ...d.toObject(), qty: d.quantity }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.patch('/:id', upload.single('image'), async (req, res) => {
  try {
    // Собираем только те поля, что действительно прислали
    const updates = {};

    if (typeof req.body.name !== 'undefined') {
      const n = String(req.body.name).trim();
      if (!n) return res.status(400).json({ error: 'Name is required' });
      updates.name = n;
    }
    const hasQty = typeof req.body.qty !== 'undefined' || typeof req.body.quantity !== 'undefined';
    if (hasQty) {
      const q = Number((req.body.quantity ?? req.body.qty));
      updates.quantity = Number.isFinite(q) ? q : 0;
    }
    if (typeof req.body.supplier !== 'undefined') updates.supplier = req.body.supplier || '';
    if (typeof req.body.location !== 'undefined') updates.location = req.body.location || '';
    if (typeof req.body.category !== 'undefined') updates.category = req.body.category || 'Trays';
    if (typeof req.body.material !== 'undefined') updates.material = req.body.material || '';
    if (typeof req.body.color !== 'undefined') updates.color = req.body.color || '';

    // Если прислали новый файл — заливаем в Cloudinary
    if (req.file) {
      try {
        const imageUrl = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'inventory' },
            (error, result) => {
              if (error) return reject(error);
              resolve(result.secure_url);
            }
          );
          stream.end(req.file.buffer);
        });
        updates.image = imageUrl;
      } catch (err) {
        console.error('Cloudinary upload failed on PATCH:', err);
        return res.status(500).json({ error: 'Image upload failed' });
      }
    }

    const doc = await Product.findByIdAndUpdate(req.params.id, updates, { new: true });
    const out = doc.toObject();
    out.qty = out.quantity;
    res.json(out);
  } catch (err) {
    console.error('PATCH /products/:id failed:', err);
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
