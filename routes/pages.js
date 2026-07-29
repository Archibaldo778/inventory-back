import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { Router } from 'express';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import Page from '../models/Page.js';
import Deck from '../models/Deck.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';
import { INVALID_IMAGE_UPLOAD_RESPONSE, isAllowedImageUpload } from '../utils/imageSignature.js';
import { clearApiCacheGroups } from '../utils/apiCache.js';
import { v2 as cloudinary } from 'cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = Router();
const clearCache = () => clearApiCacheGroups('pages', 'decks');

const ensureUploadsDir = async () => {
  const target = path.join(__dirname, '..', 'uploads', 'board');
  await fs.promises.mkdir(target, { recursive: true });
  return target;
};

const writeLocalBoardImage = async (file) => {
  if (!file?.buffer) return '';
  const uploadsDir = await ensureUploadsDir();
  const original = String(file.originalname || '').trim();
  const ext = (path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '')) || '.jpg';
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) ? ext : '.jpg';
  const filename = `board-${Date.now()}-${crypto.randomUUID()}${safeExt}`;
  const destination = path.join(uploadsDir, filename);
  await fs.promises.writeFile(destination, file.buffer);
  return `/uploads/board/${filename}`;
};

const shouldFallbackToLocalUpload = () => {
  const explicit = String(process.env.BOARD_UPLOAD_FALLBACK || '').trim().toLowerCase();
  if (explicit === 'local') return true;
  if (explicit === 'cloudinary-only') return false;
  return process.env.NODE_ENV !== 'production';
};

const uploadBoardImageToCloudinary = (file) => new Promise((resolve, reject) => {
  const mime = String(file?.mimetype || '').toLowerCase();
  const originalName = String(file?.originalname || '').toLowerCase();
  const shouldForceJpeg = mime.includes('heic') || mime.includes('heif') || /\.(heic|heif)$/i.test(originalName);
  const uploadOptions = {
    folder: process.env.CLOUDINARY_BOARD_FOLDER || 'board',
    resource_type: 'image',
  };
  if (shouldForceJpeg) uploadOptions.format = 'jpg';
  const stream = cloudinary.uploader.upload_stream(
    uploadOptions,
    (error, result) => {
      if (error) return reject(error);
      resolve(result?.secure_url || result?.url || null);
    }
  );
  Readable.from(file.buffer).pipe(stream);
});

const storage = multer.memoryStorage();
const isAcceptedImageUpload = (file) => {
  const mime = String(file?.mimetype || '').toLowerCase();
  const originalName = String(file?.originalname || '').toLowerCase();
  if (/jpeg|jpg|png|webp|heic|heif/.test(mime)) return true;
  if (/\.(jpe?g|png|webp|heic|heif)$/i.test(originalName)) return true;
  return false;
};

const imageUpload = multer({
  storage,
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 21,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ok = isAcceptedImageUpload(file);
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const sanitizePageCanvasForResponse = (pageDoc) => {
  const page = pageDoc?.toObject ? pageDoc.toObject() : pageDoc;
  if (!page || typeof page !== 'object') return page;

  const nextCanvas = sanitizeBoardCanvas(page.canvas);

  return {
    ...page,
    canvas: nextCanvas,
  };
};

// Create page
router.post('/', async (req, res) => {
  try {
    const { deckId, index = 0, canvas = {}, preview = '' } = req.body || {};
    if (!deckId) return res.status(400).json({ error: 'deckId is required' });
    const deckExists = await Deck.exists({ _id: deckId });
    if (!deckExists) return res.status(404).json({ error: 'Deck not found' });
    const page = await Page.create({
      deckId,
      index,
      canvas: sanitizeBoardCanvas(canvas),
      preview,
    });
    res.status(201).json(page);
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get page
router.get('/:id', async (req, res) => {
  try {
    const page = await Page.findById(req.params.id);
    if (!page) return res.status(404).json({ error: 'Not found' });
    const responsePage = sanitizePageCanvasForResponse(page);
    res.json(responsePage);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/upload-image', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }
    if (!isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
      return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    }
    let src = '';
    try {
      src = await uploadBoardImageToCloudinary(req.file);
    } catch (error) {
      if (!shouldFallbackToLocalUpload()) {
        throw error;
      }
      src = await writeLocalBoardImage(req.file);
    }
    if (!src) {
      return res.status(500).json({ error: 'Failed to upload board image' });
    }
    return res.status(201).json({ src });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Failed to upload board image' });
  }
});

// Update page (canvas/preview/index)
router.patch('/:id', async (req, res) => {
  try {
    const updates = {};
    ['index', 'preview'].forEach((k) => {
      if (typeof req.body[k] !== 'undefined') updates[k] = req.body[k];
    });
    if (typeof req.body.canvas !== 'undefined') {
      updates.canvas = sanitizeBoardCanvas(req.body.canvas);
    }

    const hasExpectedRevision = req.body?.expectedRevision !== undefined;
    const expectedRevision = Number(req.body?.expectedRevision);
    if (hasExpectedRevision && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      return res.status(400).json({ error: 'expectedRevision must be a non-negative integer' });
    }

    const filter = { _id: req.params.id };
    if (hasExpectedRevision) filter.revision = expectedRevision;
    const page = await Page.findOneAndUpdate(filter, {
      $set: updates,
      $inc: { revision: 1 },
    }, {
      new: true,
      runValidators: true,
    });
    if (!page) {
      if (hasExpectedRevision) {
        const current = await Page.findById(req.params.id).select('_id revision updatedAt').lean();
        if (current) {
          return res.status(409).json({
            error: 'Page was changed by another session. Reload before saving again.',
            code: 'PAGE_REVISION_CONFLICT',
            currentRevision: current.revision,
            updatedAt: current.updatedAt,
          });
        }
      }
      return res.status(404).json({ error: 'Not found' });
    }

    const responsePage = sanitizePageCanvasForResponse(page);
    res.json(responsePage);
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete page
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Page.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
    clearCache();
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
