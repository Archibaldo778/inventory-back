import multer from 'multer';
import { Router } from 'express';
import apicache from 'apicache';
import Product from '../models/Product.js';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = Router();
const cache = apicache.middleware;
const CACHE_GROUP = 'products';
const TAPE_LIBRARY_PREFIX = '__nexel_tape_library__';
const DEFAULT_TAPE_CATEGORY_KEY = 'tape-swatches-colors';
const DEFAULT_INVENTORY_FOLDER = process.env.CLOUDINARY_INVENTORY_FOLDER || 'inventory';
const DEFAULT_TAPE_FOLDER_ROOT = process.env.CLOUDINARY_TAPE_FOLDER_ROOT || 'tapes';
const TAPE_CATEGORY_FOLDERS = Object.freeze({
  'allergy-stickers': 'allergy-stickers',
  'tape-swatches-colors': 'tape-swatches-colors',
  'tape-swatches-prints': 'tape-swatches-prints',
  'tape-swatches-low-inventory': 'tape-swatches-low-inventory',
});
const SIZE_LIST_SPLIT_RE = /[,;\n|]+/;
const SIZE_BODY_KEYS = Object.freeze([
  'sizes',
  'sizeOptions',
  'size_options',
  'sizeVariants',
  'size_variants',
  'selectedSize',
  'selected_size',
  'size',
  'sizeLabel',
  'size_label',
  'sizeWidth',
  'size_width',
  'widthIn',
  'width_in',
  'sizeHeight',
  'size_height',
  'heightIn',
  'height_in',
  'sizeDepth',
  'size_depth',
  'depthIn',
  'depth_in',
  'sizeLength',
  'size_length',
  'sizeLetter',
  'size_letter',
  'letterSize',
  'letter_size',
  'sizeCode',
  'size_code',
  'selectedSizeDimensions',
  'selected_size_dimensions',
  'sizeDimensions',
  'size_dimensions',
]);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const cacheWithGroup = (duration, group) => {
  const middleware = cache(duration);
  return (req, res, next) => {
    res.apicacheGroup = group;
    return middleware(req, res, next);
  };
};

const clearCache = () => {
  apicache.clear(CACHE_GROUP);
};

const normalizeTapeCategoryKey = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === TAPE_LIBRARY_PREFIX) return DEFAULT_TAPE_CATEGORY_KEY;
  const prefix = `${TAPE_LIBRARY_PREFIX}:`;
  if (!raw.startsWith(prefix)) return '';
  const key = raw.slice(prefix.length).trim() || DEFAULT_TAPE_CATEGORY_KEY;
  return Object.prototype.hasOwnProperty.call(TAPE_CATEGORY_FOLDERS, key)
    ? key
    : DEFAULT_TAPE_CATEGORY_KEY;
};

const resolveCloudinaryFolderForCategory = (categoryValue) => {
  const tapeCategoryKey = normalizeTapeCategoryKey(categoryValue);
  if (!tapeCategoryKey) return DEFAULT_INVENTORY_FOLDER;
  const tapeSubfolder = TAPE_CATEGORY_FOLDERS[tapeCategoryKey] || TAPE_CATEGORY_FOLDERS[DEFAULT_TAPE_CATEGORY_KEY];
  return `${DEFAULT_TAPE_FOLDER_ROOT}/${tapeSubfolder}`;
};

const uploadImageToCloudinary = (file, categoryValue = '') => new Promise((resolve, reject) => {
  const folder = resolveCloudinaryFolderForCategory(categoryValue);
  const stream = cloudinary.uploader.upload_stream(
    { folder },
    (error, result) => {
      if (error) return reject(error);
      resolve(result?.secure_url || result?.url || null);
    }
  );
  stream.end(file.buffer);
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|webp/.test((file.mimetype || '').toLowerCase());
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const normalizeString = (value, { upper = false } = {}) => {
  if (value === undefined || value === null) return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return upper ? normalized.toUpperCase() : normalized;
};

const dedupeStrings = (list) => {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const normalized = normalizeString(entry);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
};

const parseStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseStringArray(entry));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
      || (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed !== value) {
          return parseStringArray(parsed);
        }
      } catch {
        // treat as plain text below
      }
    }
    return trimmed
      .split(SIZE_LIST_SPLIT_RE)
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    const maybeList = [
      value.sizes,
      value.sizeOptions,
      value.size_options,
      value.sizeVariants,
      value.size_variants,
      value.options,
      value.values,
    ];
    const resolved = maybeList.flatMap((entry) => parseStringArray(entry));
    if (resolved.length) return resolved;
    const scalar = [
      value.selectedSize,
      value.selected_size,
      value.size,
      value.sizeLabel,
      value.size_label,
      value.label,
      value.value,
      value.name,
      value.title,
    ]
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
    return scalar;
  }
  return [normalizeString(value)].filter(Boolean);
};

const pickFirstBodyValue = (body, keys) => {
  for (const key of keys) {
    if (hasOwn(body, key)) return body[key];
  }
  return undefined;
};

const parseNumberOrUndefined = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
};

const parseSelectedSizeDimensions = (body) => {
  const raw = pickFirstBodyValue(body, [
    'selectedSizeDimensions',
    'selected_size_dimensions',
    'sizeDimensions',
    'size_dimensions',
  ]);
  if (raw === undefined || raw === null || raw === '') return undefined;

  let source = raw;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return undefined;
    try {
      source = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;

  const width = parseNumberOrUndefined(source.width ?? source.w ?? source.x);
  const height = parseNumberOrUndefined(source.height ?? source.h ?? source.y ?? source.length ?? source.l);
  const depth = parseNumberOrUndefined(source.depth ?? source.d ?? source.z ?? source.length ?? source.l);
  const length = parseNumberOrUndefined(source.length ?? source.l ?? source.depth ?? source.d);

  const out = {};
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  if (depth !== undefined) out.depth = depth;
  if (length !== undefined) out.length = length;

  return Object.keys(out).length ? out : undefined;
};

const buildSizePayload = (body, { forUpdate = false } = {}) => {
  const hasAnyInput = SIZE_BODY_KEYS.some((key) => hasOwn(body, key));
  if (!hasAnyInput) return { hasAnyInput: false, payload: {} };

  const listRaw = pickFirstBodyValue(body, ['sizeOptions', 'size_options', 'sizes', 'sizeVariants', 'size_variants']);
  let sizeOptions = dedupeStrings(parseStringArray(listRaw));

  let selectedSize = normalizeString(
    pickFirstBodyValue(body, ['selectedSize', 'selected_size', 'size', 'sizeLabel', 'size_label'])
  );
  let sizeLabel = normalizeString(
    pickFirstBodyValue(body, ['sizeLabel', 'size_label', 'selectedSize', 'selected_size', 'size'])
  );

  const sizeWidth = normalizeString(
    pickFirstBodyValue(body, ['sizeWidth', 'size_width', 'widthIn', 'width_in'])
  );
  const sizeHeight = normalizeString(
    pickFirstBodyValue(body, ['sizeHeight', 'size_height', 'heightIn', 'height_in'])
  );
  const sizeDepth = normalizeString(
    pickFirstBodyValue(body, ['sizeDepth', 'size_depth', 'depthIn', 'depth_in', 'sizeLength', 'size_length'])
  );
  const sizeLetter = normalizeString(
    pickFirstBodyValue(body, ['sizeLetter', 'size_letter', 'letterSize', 'letter_size', 'sizeCode', 'size_code']),
    { upper: true }
  );

  if (selectedSize && !sizeOptions.some((entry) => entry.toLowerCase() === selectedSize.toLowerCase())) {
    sizeOptions = [selectedSize, ...sizeOptions];
  }
  if (!selectedSize && sizeOptions.length) selectedSize = sizeOptions[0];
  if (!sizeLabel && selectedSize) sizeLabel = selectedSize;

  const selectedSizeDimensions = parseSelectedSizeDimensions(body);

  const payload = {
    sizes: sizeOptions,
    sizeOptions,
    selectedSize: selectedSize || '',
    sizeLabel: sizeLabel || '',
    sizeWidth: sizeWidth || '',
    sizeHeight: sizeHeight || '',
    sizeDepth: sizeDepth || '',
    sizeLetter: sizeLetter || '',
    selectedSizeDimensions: selectedSizeDimensions ?? (forUpdate ? null : undefined),
  };

  return { hasAnyInput: true, payload };
};

// CREATE
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const {
      name,
      qty,
      quantity,
      supplier,
      location,
      category,
      material,
      color,
      description,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const categoryValue = String(category || '').trim() || 'Trays';
    const qtyNum = Number((quantity ?? qty) ?? 0);
    let image = null;

    if (req.file) {
      try {
        image = await uploadImageToCloudinary(req.file, categoryValue);
      } catch (err) {
        console.error('Cloudinary upload failed:', err);
        return res.status(500).json({ error: 'Image upload failed' });
      }
    }

    const sizeMeta = buildSizePayload(req.body, { forUpdate: false });

    const doc = await Product.create({
      name: name.trim(),
      quantity: Number.isFinite(qtyNum) ? qtyNum : 0,
      supplier: supplier || '',
      location: location || '',
      category: categoryValue,
      material: material || '',
      color: color || '',
      description: description || '',
      image,
      ...(sizeMeta.hasAnyInput ? sizeMeta.payload : {}),
    });

    const out = doc.toObject();
    out.qty = out.quantity;
    res.status(201).json(out);
    clearCache();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ all
router.get('/', cacheWithGroup('5 minutes', CACHE_GROUP), async (_req, res) => {
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
    const currentDoc = await Product.findById(req.params.id);
    if (!currentDoc) return res.status(404).json({ error: 'Not found' });

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

    let nextCategoryValue = String(currentDoc.category || '').trim() || 'Trays';
    if (typeof req.body.category !== 'undefined') {
      nextCategoryValue = String(req.body.category || '').trim() || 'Trays';
      updates.category = nextCategoryValue;
    }

    if (typeof req.body.material !== 'undefined') updates.material = req.body.material || '';
    if (typeof req.body.color !== 'undefined') updates.color = req.body.color || '';
    if (typeof req.body.description !== 'undefined') updates.description = req.body.description || '';

    const sizeMeta = buildSizePayload(req.body, { forUpdate: true });
    if (sizeMeta.hasAnyInput) {
      Object.assign(updates, sizeMeta.payload);
    }

    if (req.file) {
      try {
        updates.image = await uploadImageToCloudinary(req.file, nextCategoryValue);
      } catch (err) {
        console.error('Cloudinary upload failed on PATCH:', err);
        return res.status(500).json({ error: 'Image upload failed' });
      }
    }

    const doc = await Product.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const out = doc.toObject();
    out.qty = out.quantity;
    res.json(out);
    clearCache();
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
    clearCache();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
