import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import BeverageItem from '../models/BeverageItem.js';
import { cleanupManagedImageSafely } from '../utils/managedImageCleanup.js';
import {
  BEVERAGE_INVENTORY_MOVEMENT_TYPES,
  resolveBeverageInventoryDelta,
} from '../utils/beverageInventory.js';
import { INVALID_IMAGE_UPLOAD_RESPONSE, isAllowedImageUpload } from '../utils/imageSignature.js';
import { sendApiError } from '../utils/apiErrors.js';
import { isAdminAuth, normalizeRole } from '../middleware/auth.js';

const router = Router();
const INVENTORY_MOVEMENT_TYPES = new Set(BEVERAGE_INVENTORY_MOVEMENT_TYPES);
const INVENTORY_UNIT_TYPES = new Set(['bottle', 'can', 'keg', 'case', 'unit']);
const INVENTORY_HISTORY_LIMIT = 200;
const INVENTORY_MANAGER_SELECT = [
  '+purchaseCost',
  '+caseCost',
  '+supplier',
  '+stockOnHand',
  '+reorderLevel',
  '+lastInventoryAt',
].join(' ');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 100,
    parts: 101,
    fieldSize: 1024 * 1024,
  },
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

const parseNonNegativeNumber = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
};

const parsePositiveNumber = (value, fallback = undefined) => {
  const numeric = parseNonNegativeNumber(value, fallback);
  return Number(numeric) > 0 ? Number(numeric) : fallback;
};

const cleanInventoryText = (value, maxLength = 240) => sanitizeStr(value).slice(0, maxLength);

const canSeeBeverageCosts = (auth) => (
  isAdminAuth(auth) || normalizeRole(auth?.role) === 'bar admin'
);

const buildInventoryFields = (body, { creating = false } = {}) => {
  const fields = {};
  const textFields = ['brand', 'sku', 'barcode', 'supplier', 'storageLocation'];
  textFields.forEach((field) => {
    if (creating || body?.[field] !== undefined) {
      fields[field] = cleanInventoryText(body?.[field]);
    }
  });
  if (creating || body?.aliases !== undefined) {
    fields.aliases = parseStringArray(body?.aliases)
      .slice(0, 50)
      .map((alias) => cleanInventoryText(alias, 160));
  }
  if (creating || body?.unitType !== undefined) {
    const unitType = cleanInventoryText(body?.unitType, 30).toLowerCase();
    fields.unitType = INVENTORY_UNIT_TYPES.has(unitType) ? unitType : 'bottle';
  }
  if (creating || body?.reorderLevel !== undefined) {
    fields.reorderLevel = parseNonNegativeNumber(body?.reorderLevel, 0);
  }
  if (creating || body?.active !== undefined) {
    fields.active = parseBoolean(body?.active);
    if (fields.active === undefined) fields.active = true;
  }
  return fields;
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

router.get('/', async (req, res) => {
  try {
    const query = BeverageItem.find().sort({ createdAt: -1 });
    if (canSeeBeverageCosts(req.auth)) query.select(INVENTORY_MANAGER_SELECT);
    const items = await query;
    res.json(items);
  } catch (err) {
    return sendApiError(res, err, {
      context: 'Beverage items list failed',
      fallbackMessage: 'Failed to list beverage items',
    });
  }
});

router.post('/', upload.single('image'), async (req, res) => {
  let uploadedImage = '';
  try {
    const body = req.body || {};
    const name = sanitizeStr(body.name);
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
      return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    }

    const category = sanitizeStr(body.category);
    const categories = normalizeCategories(category, parseStringArray(body.categories));
    const initialStock = parseNonNegativeNumber(body.initialStock ?? body.stockOnHand, 0);
    const inventoryFields = buildInventoryFields(body, { creating: true });
    const payload = {
      name,
      description: sanitizeStr(body.description),
      category,
      subCategory: sanitizeStr(body.subCategory ?? body.sub_category),
      categories,
      tags: parseStringArray(body.tags),
      isAlcohol: parseBoolean(body.isAlcohol ?? body.is_alcohol) ?? false,
      purchaseCost: parseNonNegativeNumber(body.purchaseCost ?? body.purchase_cost, 0),
      bottleSizeMl: parseNonNegativeNumber(body.bottleSizeMl ?? body.bottle_size_ml, null),
      caseCost: parseNonNegativeNumber(body.caseCost ?? body.case_cost, null),
      caseSize: parsePositiveNumber(body.caseSize ?? body.case_size, null),
      ...inventoryFields,
      stockOnHand: initialStock,
      lastInventoryAt: initialStock > 0 ? new Date() : null,
      inventoryMovements: initialStock > 0 ? [{
        type: 'initial',
        quantityDelta: initialStock,
        note: 'Opening inventory',
        actorUserId: String(req.auth?.userId || ''),
        actorName: String(req.auth?.username || req.auth?.email || ''),
        unitCostSnapshot: parseNonNegativeNumber(body.purchaseCost ?? body.purchase_cost, 0),
      }] : [],
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
            return sendApiError(res, fallbackErr, {
              context: 'Local beverage image fallback failed',
              fallbackMessage: 'Failed to upload beverage image',
            });
          }
        } else {
          return sendApiError(res, err, {
            context: 'Cloudinary beverage image upload failed',
            fallbackMessage: 'Failed to upload beverage image',
          });
        }
      }
      uploadedImage = payload.image || '';
    } else if (body.image !== undefined) {
      payload.image = sanitizeStr(body.image) || null;
    }

    const created = await BeverageItem.create(payload);
    const responseItem = await BeverageItem.findById(created._id).select(INVENTORY_MANAGER_SELECT);
    res.status(201).json(responseItem || created);
  } catch (err) {
    if (uploadedImage) await cleanupManagedImageSafely(uploadedImage, 'orphaned beverage image');
    return sendApiError(res, err, {
      context: 'Beverage item creation failed',
      fallbackMessage: 'Failed to create beverage item',
    });
  }
});

router.patch('/:id', upload.single('image'), async (req, res) => {
  let uploadedImage = '';
  try {
    const body = req.body || {};
    const updates = {};
    const current = await BeverageItem.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
      return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    }

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
      const baseCategory = category !== undefined ? category : sanitizeStr(current.category);
      const baseCategories = body.categories !== undefined ? parseStringArray(body.categories) : (Array.isArray(current.categories) ? current.categories : []);
      updates.categories = normalizeCategories(baseCategory, baseCategories);
    }
    if (body.isAlcohol !== undefined || body.is_alcohol !== undefined) {
      const bool = parseBoolean(body.isAlcohol ?? body.is_alcohol);
      updates.isAlcohol = Boolean(bool);
    }
    if (body.purchaseCost !== undefined || body.purchase_cost !== undefined) {
      updates.purchaseCost = parseNonNegativeNumber(body.purchaseCost ?? body.purchase_cost, 0);
    }
    if (body.bottleSizeMl !== undefined || body.bottle_size_ml !== undefined) {
      updates.bottleSizeMl = parseNonNegativeNumber(body.bottleSizeMl ?? body.bottle_size_ml, null);
    }
    if (body.caseCost !== undefined || body.case_cost !== undefined) {
      updates.caseCost = parseNonNegativeNumber(body.caseCost ?? body.case_cost, null);
    }
    if (body.caseSize !== undefined || body.case_size !== undefined) {
      updates.caseSize = parsePositiveNumber(body.caseSize ?? body.case_size, null);
    }
    Object.assign(updates, buildInventoryFields(body));
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
            return sendApiError(res, fallbackErr, {
              context: 'Local beverage image update fallback failed',
              fallbackMessage: 'Failed to upload beverage image',
            });
          }
        } else {
          return sendApiError(res, err, {
            context: 'Cloudinary beverage image update failed',
            fallbackMessage: 'Failed to upload beverage image',
          });
        }
      }
      uploadedImage = updates.image || '';
    } else if (body.image !== undefined) {
      updates.image = sanitizeStr(body.image) || null;
    }

    const updated = await BeverageItem.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select(INVENTORY_MANAGER_SELECT);
    if (!updated) {
      if (uploadedImage) {
        await cleanupManagedImageSafely(uploadedImage, 'orphaned beverage image');
        uploadedImage = '';
      }
      return res.status(404).json({ error: 'Not found' });
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, 'image')
      && current.image
      && String(current.image) !== String(updates.image || '')
    ) {
      await cleanupManagedImageSafely(current.image, 'beverage image');
    }
    res.json(updated);
  } catch (err) {
    if (uploadedImage) await cleanupManagedImageSafely(uploadedImage, 'orphaned beverage image');
    return sendApiError(res, err, {
      context: 'Beverage item update failed',
      fallbackMessage: 'Failed to update beverage item',
    });
  }
});

router.get('/:id/movements', async (req, res) => {
  try {
    if (!canSeeBeverageCosts(req.auth)) {
      return res.status(403).json({ message: 'Beverage inventory manager access required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(400).json({ message: 'Invalid beverage item id' });
    }
    const item = await BeverageItem.findById(req.params.id)
      .select(`${INVENTORY_MANAGER_SELECT} +inventoryMovements name unitType`);
    if (!item) return res.status(404).json({ message: 'Beverage item not found' });
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(INVENTORY_HISTORY_LIMIT, Math.floor(requestedLimit)))
      : 100;
    const movements = [...(item.inventoryMovements || [])]
      .sort((left, right) => new Date(right.at) - new Date(left.at))
      .slice(0, limit);
    return res.json({
      itemId: item._id,
      name: item.name,
      unitType: item.unitType,
      stockOnHand: item.stockOnHand,
      movements,
    });
  } catch (err) {
    return sendApiError(res, err, {
      context: 'Beverage inventory history failed',
      fallbackMessage: 'Failed to load beverage inventory history',
    });
  }
});

router.post('/:id/movements', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(400).json({ message: 'Invalid beverage item id' });
    }
    const type = cleanInventoryText(req.body?.type, 30).toLowerCase();
    if (!INVENTORY_MOVEMENT_TYPES.has(type)) {
      return res.status(400).json({ message: 'Invalid inventory movement type' });
    }
    const quantityDelta = resolveBeverageInventoryDelta(
      type,
      req.body?.quantityDelta ?? req.body?.quantity
    );
    if (quantityDelta === null) {
      return res.status(400).json({ message: 'Movement quantity must be non-zero' });
    }
    const movement = {
      type,
      quantityDelta,
      note: cleanInventoryText(req.body?.note, 1000),
      actorUserId: String(req.auth?.userId || ''),
      actorName: String(req.auth?.username || req.auth?.email || ''),
      unitCostSnapshot: parseNonNegativeNumber(req.body?.unitCostSnapshot, 0),
      at: new Date(),
    };
    const filter = {
      _id: req.params.id,
      ...(quantityDelta < 0 ? { stockOnHand: { $gte: Math.abs(quantityDelta) } } : {}),
    };
    const updated = await BeverageItem.findOneAndUpdate(
      filter,
      {
        $inc: { stockOnHand: quantityDelta },
        $set: { lastInventoryAt: movement.at },
        $push: {
          inventoryMovements: {
            $each: [movement],
            $slice: -INVENTORY_HISTORY_LIMIT,
          },
        },
      },
      { new: true, runValidators: true }
    ).select(INVENTORY_MANAGER_SELECT);
    if (!updated) {
      const exists = await BeverageItem.exists({ _id: req.params.id });
      if (!exists) return res.status(404).json({ message: 'Beverage item not found' });
      return res.status(409).json({ message: 'This movement would make inventory negative' });
    }
    return res.json(updated);
  } catch (err) {
    return sendApiError(res, err, {
      context: 'Beverage inventory movement failed',
      fallbackMessage: 'Failed to update beverage inventory',
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const current = await BeverageItem.findById(req.params.id)
      .select('+stockOnHand +inventoryMovements');
    if (!current) return res.status(404).json({ error: 'Not found' });
    if (Number(current.stockOnHand || 0) !== 0 || current.inventoryMovements.length > 0) {
      return res.status(409).json({
        message: 'Inventory items with stock or movement history must be deactivated, not deleted',
      });
    }
    const deleted = await BeverageItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await cleanupManagedImageSafely(deleted.image, 'beverage image');
    res.json({ ok: true });
  } catch (err) {
    return sendApiError(res, err, {
      context: 'Beverage item deletion failed',
      fallbackMessage: 'Failed to delete beverage item',
    });
  }
});

export default router;
