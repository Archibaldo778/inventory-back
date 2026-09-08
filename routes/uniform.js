import multer from 'multer';
import { Router } from 'express';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import UniformItem from '../models/UniformItem.js';
import { cleanupManagedImageSafely } from '../utils/managedImageCleanup.js';
import { INVALID_IMAGE_UPLOAD_RESPONSE, isAllowedImageUpload } from '../utils/imageSignature.js';
import { sendApiError } from '../utils/apiErrors.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 50 },
});

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeSizes = (value) => {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  const merged = new Map();
  (Array.isArray(source) ? source : []).forEach((entry) => {
    const label = cleanText(entry?.label ?? entry?.size);
    if (!label) return;
    const quantity = Math.max(0, Math.floor(Number(entry?.quantity ?? entry?.qty) || 0));
    const key = label.toLowerCase();
    const current = merged.get(key);
    merged.set(key, current
      ? { ...current, quantity: current.quantity + quantity }
      : { label, quantity });
  });
  return [...merged.values()].slice(0, 50);
};

const uploadImage = (file) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: process.env.CLOUDINARY_UNIFORM_FOLDER || 'uniform', resource_type: 'image' },
    (error, result) => error ? reject(error) : resolve(result?.secure_url || result?.url || '')
  );
  Readable.from(file.buffer).pipe(stream);
});

const buildFields = (body, { partial = false } = {}) => {
  const fields = {};
  ['name', 'category', 'description', 'color', 'material', 'supplier', 'location'].forEach((key) => {
    if (!partial || Object.prototype.hasOwnProperty.call(body || {}, key)) fields[key] = cleanText(body?.[key]);
  });
  if (!partial || Object.prototype.hasOwnProperty.call(body || {}, 'sizes')) {
    fields.sizes = normalizeSizes(body?.sizes);
    fields.quantity = fields.sizes.reduce((sum, size) => sum + size.quantity, 0);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body || {}, 'hidden')) {
    fields.hidden = ['1', 'true', 'yes', 'on'].includes(String(body?.hidden || '').toLowerCase());
  }
  return fields;
};

router.get('/', async (_req, res) => {
  try {
    const items = await UniformItem.find({}).sort({ name: 1, createdAt: -1 });
    return res.json(items.map((item) => ({ ...item.toObject(), qty: item.quantity })));
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform list failed', fallbackMessage: 'Failed to list uniform items' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await UniformItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Uniform item not found' });
    return res.json({ ...item.toObject(), qty: item.quantity });
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform lookup failed', fallbackMessage: 'Failed to load uniform item' });
  }
});

router.post('/', upload.single('image'), async (req, res) => {
  let image = '';
  try {
    const fields = buildFields(req.body);
    if (!fields.name) return res.status(400).json({ error: 'Name is required' });
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
      return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    }
    if (req.file) image = await uploadImage(req.file);
    const item = await UniformItem.create({ ...fields, image, imageUrl: image, images: image ? [image] : [] });
    return res.status(201).json({ ...item.toObject(), qty: item.quantity });
  } catch (error) {
    if (image) await cleanupManagedImageSafely(image, 'orphaned uniform image');
    return sendApiError(res, error, { context: 'Uniform creation failed', fallbackMessage: 'Failed to create uniform item' });
  }
});

router.patch('/:id', upload.single('image'), async (req, res) => {
  let uploadedImage = '';
  try {
    const current = await UniformItem.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Uniform item not found' });
    const fields = buildFields(req.body, { partial: true });
    if (Object.prototype.hasOwnProperty.call(fields, 'name') && !fields.name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
      return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    }
    if (req.file) {
      uploadedImage = await uploadImage(req.file);
      fields.image = uploadedImage;
      fields.imageUrl = uploadedImage;
      fields.images = [uploadedImage];
    }
    const previousImage = current.image || current.imageUrl || '';
    Object.assign(current, fields);
    await current.save();
    if (uploadedImage && previousImage && previousImage !== uploadedImage) {
      await cleanupManagedImageSafely(previousImage, 'replaced uniform image');
    }
    return res.json({ ...current.toObject(), qty: current.quantity });
  } catch (error) {
    if (uploadedImage) await cleanupManagedImageSafely(uploadedImage, 'orphaned uniform image');
    return sendApiError(res, error, { context: 'Uniform update failed', fallbackMessage: 'Failed to update uniform item' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await UniformItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Uniform item not found' });
    const images = [...new Set([item.image, item.imageUrl, ...(item.images || [])].filter(Boolean))];
    await Promise.all(images.map((image) => cleanupManagedImageSafely(image, 'uniform image')));
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform deletion failed', fallbackMessage: 'Failed to delete uniform item' });
  }
});

export default router;
