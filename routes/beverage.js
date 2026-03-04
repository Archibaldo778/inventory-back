import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import BeverageItem from '../models/BeverageItem.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const originalName = String(file?.originalname || '').toLowerCase();
    const ok = /jpeg|jpg|png|webp|heic|heif/.test(mime)
      || /\.(jpe?g|png|webp|heic|heif)$/i.test(originalName);
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const sanitizeStr = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((entry) => sanitizeStr(entry)).filter(Boolean);
  const str = sanitizeStr(value);
  if (!str) return [];
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map((entry) => sanitizeStr(entry)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return str.split(',').map((entry) => sanitizeStr(entry)).filter(Boolean);
};

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const ensureUploadsDir = async () => {
  const target = path.join(__dirname, '..', 'uploads', 'beverage');
  await fs.promises.mkdir(target, { recursive: true });
  return target;
};

const writeLocalBeverageImage = async (file) => {
  if (!file?.buffer) return '';
  const uploadsDir = await ensureUploadsDir();
  const original = String(file.originalname || '').trim();
  const ext = (path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '')) || '.jpg';
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
  const filename = `beverage-${Date.now()}-${crypto.randomUUID()}${safeExt}`;
  const destination = path.join(uploadsDir, filename);
  await fs.promises.writeFile(destination, file.buffer);
  return `/uploads/beverage/${filename}`;
};

const shouldFallbackToLocalUpload = () => {
  const explicit = String(process.env.BEVERAGE_UPLOAD_FALLBACK || '').trim().toLowerCase();
  if (explicit === 'local') return true;
  if (explicit === 'cloudinary-only') return false;
  return process.env.NODE_ENV !== 'production';
};

const uploadToCloudinary = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('');
  const folder = process.env.CLOUDINARY_BEVERAGE_FOLDER || 'beverage';
  const mime = String(file.mimetype || '').toLowerCase();
  const originalName = String(file?.originalname || '').toLowerCase();
  const shouldForceJpeg = mime.includes('heic') || mime.includes('heif') || /\.(heic|heif)$/i.test(originalName);
  const uploadOptions = { folder, resource_type: 'image' };
  if (shouldForceJpeg) uploadOptions.format = 'jpg';
  const stream = cloudinary.uploader.upload_stream(
    uploadOptions,
    (error, result) => {
      if (error) return reject(error);
      resolve(result?.secure_url || result?.url || '');
    }
  );
  Readable.from(file.buffer).pipe(stream);
});

const normalizeCategories = (category, categories) => {
  const list = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (category && !list.includes(category)) return [category, ...list];
  return list;
};

router.get('/', async (_req, res) => {
  try {
    const items = await BeverageItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('image'), async (req, res) => {
  try {
    const body = req.body || {};
    const name = sanitizeStr(body.name);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const category = sanitizeStr(body.category);
    const categories = normalizeCategories(category, parseStringArray(body.categories));
    const payload = {
      name,
      description: sanitizeStr(body.description),
      category,
      subCategory: sanitizeStr(body.subCategory ?? body.sub_category),
      categories,
      tags: parseStringArray(body.tags),
      isAlcohol: parseBoolean(body.isAlcohol ?? body.is_alcohol) ?? false,
    };

    if (req.file) {
      try {
        payload.image = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed (beverage)', err);
        if (shouldFallbackToLocalUpload()) {
          try {
            payload.image = await writeLocalBeverageImage(req.file);
          } catch (fallbackErr) {
            console.error('Local beverage image fallback failed', fallbackErr);
            return res.status(500).json({ error: `Failed to upload beverage image: ${fallbackErr?.message || fallbackErr}` });
          }
        } else {
          return res.status(500).json({ error: `Failed to upload beverage image: ${err?.message || err}` });
        }
      }
    } else if (body.image !== undefined) {
      payload.image = sanitizeStr(body.image) || null;
    }

    const created = await BeverageItem.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', upload.single('image'), async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) {
      const nextName = sanitizeStr(body.name);
      if (!nextName) return res.status(400).json({ error: 'name is required' });
      updates.name = nextName;
    }
    if (body.description !== undefined) updates.description = sanitizeStr(body.description);
    if (body.category !== undefined) updates.category = sanitizeStr(body.category);
    if (body.subCategory !== undefined || body.sub_category !== undefined) {
      updates.subCategory = sanitizeStr(body.subCategory ?? body.sub_category);
    }
    if (body.tags !== undefined) updates.tags = parseStringArray(body.tags);
    if (body.categories !== undefined || body.category !== undefined) {
      const category = body.category !== undefined
        ? sanitizeStr(body.category)
        : undefined;
      const existing = await BeverageItem.findById(req.params.id).select('category categories');
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const baseCategory = category !== undefined ? category : sanitizeStr(existing.category);
      const baseCategories = body.categories !== undefined ? parseStringArray(body.categories) : (Array.isArray(existing.categories) ? existing.categories : []);
      updates.categories = normalizeCategories(baseCategory, baseCategories);
    }
    if (body.isAlcohol !== undefined || body.is_alcohol !== undefined) {
      const bool = parseBoolean(body.isAlcohol ?? body.is_alcohol);
      updates.isAlcohol = Boolean(bool);
    }
    if (body.removeImage !== undefined && parseBoolean(body.removeImage)) {
      updates.image = null;
    }

    if (req.file) {
      try {
        updates.image = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed (beverage)', err);
        if (shouldFallbackToLocalUpload()) {
          try {
            updates.image = await writeLocalBeverageImage(req.file);
          } catch (fallbackErr) {
            console.error('Local beverage image fallback failed', fallbackErr);
            return res.status(500).json({ error: `Failed to upload beverage image: ${fallbackErr?.message || fallbackErr}` });
          }
        } else {
          return res.status(500).json({ error: `Failed to upload beverage image: ${err?.message || err}` });
        }
      }
    } else if (body.image !== undefined) {
      updates.image = sanitizeStr(body.image) || null;
    }

    const updated = await BeverageItem.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await BeverageItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
