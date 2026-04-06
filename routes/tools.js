import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';

const router = Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const hasCloudinaryConfig = Boolean(
  String(process.env.CLOUDINARY_CLOUD_NAME || '').trim()
  && String(process.env.CLOUDINARY_API_KEY || '').trim()
  && String(process.env.CLOUDINARY_API_SECRET || '').trim()
);
const photoRoomApiKey = String(process.env.PHOTOROOM_API_KEY || '').trim();
const hasPhotoRoomConfig = Boolean(photoRoomApiKey);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const originalName = String(file?.originalname || '').toLowerCase();
    const ok = mime.includes('heic') || mime.includes('heif') || /\.(heic|heif)$/i.test(originalName);
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const originalName = String(file?.originalname || '').toLowerCase();
    const ok = /jpeg|jpg|png|webp|heic|heif/.test(mime) || /\.(jpe?g|png|webp|heic|heif)$/i.test(originalName);
    if (ok) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const uploadHeifAsJpg = (file) => new Promise((resolve, reject) => {
  if (!file?.buffer) return reject(new Error('image file is required'));
  const folder = process.env.CLOUDINARY_HEIF_CONVERT_FOLDER || 'tmp/heif-convert';
  const stream = cloudinary.uploader.upload_stream(
    {
      folder,
      resource_type: 'image',
      format: 'jpg',
      overwrite: false,
      unique_filename: true,
    },
    (error, result) => {
      if (error) return reject(error);
      resolve(result || null);
    }
  );
  Readable.from(file.buffer).pipe(stream);
});

const tryCleanupUpload = async (result) => {
  const publicId = String(result?.public_id || '').trim();
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });
  } catch {
    // Ignore cleanup failures: conversion already succeeded.
  }
};

router.post('/heif-to-jpg', upload.single('image'), async (req, res) => {
  if (!hasCloudinaryConfig) {
    return res.status(500).json({ error: 'Cloudinary is not configured for server-side HEIF conversion' });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'image file is required' });
  }

  let uploadResult = null;
  try {
    uploadResult = await uploadHeifAsJpg(req.file);
    const url = String(uploadResult?.secure_url || uploadResult?.url || '').trim();
    if (!url) {
      return res.status(500).json({ error: 'Cloudinary conversion produced no output URL' });
    }

    const convertedRes = await fetch(url, { method: 'GET' });
    if (!convertedRes.ok) {
      return res.status(502).json({ error: `Failed to download converted JPG (${convertedRes.status})` });
    }

    const bytes = await convertedRes.arrayBuffer();
    const buffer = Buffer.from(bytes);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (uploadResult) {
      await tryCleanupUpload(uploadResult);
    }
  }
});

router.post('/remove-background', imageUpload.single('image'), async (req, res) => {
  if (!hasPhotoRoomConfig) {
    return res.status(500).json({ error: 'Photoroom is not configured on the server' });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'image file is required' });
  }

  const format = ['png', 'jpg', 'webp'].includes(String(req.body?.format || '').trim().toLowerCase())
    ? String(req.body.format).trim().toLowerCase()
    : 'png';
  const size = ['preview', 'medium', 'hd', 'full'].includes(String(req.body?.size || '').trim().toLowerCase())
    ? String(req.body.size).trim().toLowerCase()
    : 'full';
  const channels = ['rgba', 'alpha'].includes(String(req.body?.channels || '').trim().toLowerCase())
    ? String(req.body.channels).trim().toLowerCase()
    : 'rgba';
  const cropRaw = String(req.body?.crop || '').trim().toLowerCase();
  const crop = cropRaw === 'true' || cropRaw === '1';

  try {
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: String(req.file.mimetype || 'application/octet-stream') });
    form.append('image_file', blob, String(req.file.originalname || 'image.png'));
    form.append('format', format);
    form.append('size', size);
    form.append('channels', channels);
    form.append('crop', String(crop));

    const response = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: {
        Accept: 'image/png, image/webp, image/jpeg, application/json',
        'x-api-key': photoRoomApiKey,
      },
      body: form,
    });

    if (!response.ok) {
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let details = '';
      try {
        if (contentType.includes('application/json')) {
          const payload = await response.json();
          details = String(payload?.error?.message || payload?.message || payload?.error || '').trim();
        } else {
          details = String(await response.text()).trim();
        }
      } catch {
        details = '';
      }
      const suffix = details ? `: ${details}` : '';
      return res.status(502).json({ error: `Photoroom remove background failed (${response.status})${suffix}` });
    }

    const contentType = String(response.headers.get('content-type') || '').trim() || 'image/png';
    const bytes = await response.arrayBuffer();
    const buffer = Buffer.from(bytes);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
