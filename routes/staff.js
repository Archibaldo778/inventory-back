import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import Staff from '../models/Staff.js';

const router = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/.test((file.mimetype || '').toLowerCase());
    cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'photo'), ok);
  },
});

const uploadToCloudinary = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('');
  const folder = process.env.CLOUDINARY_FOLDER || 'staff';
  const stream = cloudinary.uploader.upload_stream(
    { folder, resource_type: 'image' },
    (error, result) => {
      if (error) return reject(error);
      resolve(result.secure_url);
    }
  );
  Readable.from(file.buffer).pipe(stream);
});

const resolvePositions = (body = {}) => {
  const bucket = [];
  let provided = false;
  const push = (val) => {
    provided = true;
    if (Array.isArray(val)) {
      val.forEach(push);
      return;
    }
    const str = String(val ?? '').trim();
    if (str) bucket.push(str);
  };
  if (typeof body['positions[]'] !== 'undefined') push(body['positions[]']);
  if (typeof body.positions !== 'undefined') {
    const raw = body.positions;
    if (Array.isArray(raw)) push(raw);
    else {
      try {
        const parsed = JSON.parse(raw);
        push(parsed);
      } catch {
        if (typeof raw === 'string') {
          push(raw.split(',').map(s => s.trim()));
        }
      }
    }
  }
  const unique = Array.from(new Set(bucket.map(String))).map(s => s.trim()).filter(Boolean);
  return { values: unique, provided };
};

const sanitizeStr = (value) => {
  if (typeof value === 'undefined' || value === null) return '';
  return String(value).trim();
};

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
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const body = req.body || {};
    const firstName = sanitizeStr(body.firstName);
    const lastName = sanitizeStr(body.lastName);
    if (!firstName || !lastName) {
      return res.status(400).json({ message: 'firstName and lastName are required' });
    }
    const { values: positions } = resolvePositions(body);
    const payload = {
      firstName,
      lastName,
      positions,
      note: sanitizeStr(body.note),
      active: typeof body.active === 'undefined' ? true : String(body.active) !== 'false',
      height: sanitizeStr(body.height),
      shirtSize: sanitizeStr(body.shirtSize),
      pantsSize: sanitizeStr(body.pantsSize),
      shoeSize: sanitizeStr(body.shoeSize),
      jacketSize: sanitizeStr(body.jacketSize),
    };
    if (req.file) {
      try {
        payload.photo = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed', err);
        return res.status(500).json({ message: 'Failed to upload staff photo' });
      }
    } else if (body.photo) {
      payload.photo = sanitizeStr(body.photo);
    }
    const doc = await Staff.create(payload);
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
router.patch('/:id', upload.single('photo'), async (req, res) => {
  try {
    const updates = {};
    const body = req.body || {};

    if (typeof body.firstName !== 'undefined') updates.firstName = sanitizeStr(body.firstName);
    if (typeof body.lastName !== 'undefined') updates.lastName = sanitizeStr(body.lastName);
    if (typeof body.note !== 'undefined') updates.note = sanitizeStr(body.note);
    if (typeof body.active !== 'undefined') updates.active = String(body.active) !== 'false';
    const { values: positions, provided } = resolvePositions(body);
    if (provided) updates.positions = positions;
    if (typeof body.height !== 'undefined') updates.height = sanitizeStr(body.height);
    if (typeof body.shirtSize !== 'undefined') updates.shirtSize = sanitizeStr(body.shirtSize);
    if (typeof body.pantsSize !== 'undefined') updates.pantsSize = sanitizeStr(body.pantsSize);
    if (typeof body.shoeSize !== 'undefined') updates.shoeSize = sanitizeStr(body.shoeSize);
    if (typeof body.jacketSize !== 'undefined') updates.jacketSize = sanitizeStr(body.jacketSize);

    if (req.file) {
      try {
        updates.photo = await uploadToCloudinary(req.file);
      } catch (err) {
        console.error('Cloudinary upload failed', err);
        return res.status(500).json({ message: 'Failed to upload staff photo' });
      }
    } else if (typeof body.photo !== 'undefined') {
      updates.photo = sanitizeStr(body.photo);
    }

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
