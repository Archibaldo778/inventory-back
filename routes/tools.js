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

export default router;
