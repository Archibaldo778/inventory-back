import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import KitchenItem from '../models/KitchenItem.js';

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
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeStr(entry)).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => sanitizeStr(entry)).filter(Boolean);
        }
      } catch {
        return [];
      }
    }
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const normalizeSeason = (value) => {
  if (value === undefined || value === null) return undefined;
  const season = String(value).trim();
  if (!season) return '';
  if (season === 'fall_winter' || season === 'spring_summer') return season;
  return '';
};

const parseSeasonYear = (value) => {
  if (value === undefined || value === null) return undefined;
  if (value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
};

const readGuestLimit = (body = {}) => (
  body.guestLimit
  ?? body.guest_limit
  ?? body.guestLimitNote
  ?? body.guest_limit_note
  ?? body.guestLimitText
  ?? body.guest_limit_text
);

const readHidden = (body = {}) => (
  body.hidden
  ?? body.isHidden
  ?? body.is_hidden
  ?? body.hideFromBoard
  ?? body.hide_from_board
  ?? body.hideFromBoards
  ?? body.hide_from_boards
);

const ensureUploadsDir = async () => {
  const target = path.join(__dirname, '..', 'uploads', 'kitchen');
  await fs.promises.mkdir(target, { recursive: true });
  return target;
};

const writeLocalKitchenImage = async (file) => {
  if (!file?.buffer) return '';
  const uploadsDir = await ensureUploadsDir();
  const original = String(file.originalname || '').trim();
  const ext = (path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '')) || '.jpg';
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
  const filename = `kitchen-${Date.now()}-${crypto.randomUUID()}${safeExt}`;
  const destination = path.join(uploadsDir, filename);
  await fs.promises.writeFile(destination, file.buffer);
  return `/uploads/kitchen/${filename}`;
};

const shouldFallbackToLocalUpload = () => {
  const explicit = String(process.env.KITCHEN_UPLOAD_FALLBACK || '').trim().toLowerCase();
  if (explicit === 'local') return true;
  if (explicit === 'cloudinary-only') return false;
  return process.env.NODE_ENV !== 'production';
};

const uploadToCloudinary = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('');
  const folder = process.env.CLOUDINARY_KITCHEN_FOLDER || 'kitchen';
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
    const body = req.body || {};
    const name = sanitizeStr(body.name);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const payload = {
      name,
      description: sanitizeStr(body.description),
      dietary: parseStringArray(body.dietary),
      categories: parseStringArray(body.categories),
      allSeason: parseBoolean(body.allSeason) ?? false,
      guestLimit: sanitizeStr(readGuestLimit(body)),
      hidden: parseBoolean(readHidden(body)) ?? false,
    };

    const season = normalizeSeason(body.season);
    if (season !== undefined) payload.season = season;

    const seasonYear = parseSeasonYear(body.seasonYear);
    if (seasonYear !== undefined) payload.seasonYear = seasonYear;

    if (req.file) {
      try {
        payload.image = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed', err);
        if (shouldFallbackToLocalUpload()) {
          try {
            payload.image = await writeLocalKitchenImage(req.file);
          } catch (fallbackErr) {
            console.error('Local kitchen image fallback failed', fallbackErr);
            return res.status(500).json({ error: `Failed to upload kitchen image: ${fallbackErr?.message || fallbackErr}` });
          }
        } else {
          return res.status(500).json({ error: `Failed to upload kitchen image: ${err?.message || err}` });
        }
      }
    } else if (body.image !== undefined) {
      payload.image = sanitizeStr(body.image) || null;
    }

    const created = await KitchenItem.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE
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
    if (body.dietary !== undefined) updates.dietary = parseStringArray(body.dietary);
    if (body.categories !== undefined) updates.categories = parseStringArray(body.categories);

    if (body.season !== undefined) updates.season = normalizeSeason(body.season) || '';
    if (body.seasonYear !== undefined) updates.seasonYear = parseSeasonYear(body.seasonYear);

    if (body.allSeason !== undefined) {
      const bool = parseBoolean(body.allSeason);
      updates.allSeason = Boolean(bool);
    }

    if (
      body.hidden !== undefined
      || body.isHidden !== undefined
      || body.is_hidden !== undefined
      || body.hideFromBoard !== undefined
      || body.hide_from_board !== undefined
      || body.hideFromBoards !== undefined
      || body.hide_from_boards !== undefined
    ) {
      updates.hidden = Boolean(parseBoolean(readHidden(body)));
    }

    if (
      body.guestLimit !== undefined
      || body.guest_limit !== undefined
      || body.guestLimitNote !== undefined
      || body.guest_limit_note !== undefined
      || body.guestLimitText !== undefined
      || body.guest_limit_text !== undefined
    ) {
      updates.guestLimit = sanitizeStr(readGuestLimit(body));
    }

    if (body.removeImage !== undefined && parseBoolean(body.removeImage)) {
      updates.image = null;
    }

    if (req.file) {
      try {
        updates.image = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed', err);
        if (shouldFallbackToLocalUpload()) {
          try {
            updates.image = await writeLocalKitchenImage(req.file);
          } catch (fallbackErr) {
            console.error('Local kitchen image fallback failed', fallbackErr);
            return res.status(500).json({ error: `Failed to upload kitchen image: ${fallbackErr?.message || fallbackErr}` });
          }
        } else {
          return res.status(500).json({ error: `Failed to upload kitchen image: ${err?.message || err}` });
        }
      }
    } else if (body.image !== undefined) {
      updates.image = sanitizeStr(body.image) || null;
    }

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
