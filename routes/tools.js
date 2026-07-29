import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { sendApiError } from '../utils/apiErrors.js';
import {
  fetchWithTimeout,
  normalizeFetchResponseLimit,
  normalizeFetchTimeout,
  readBoundedResponseBuffer,
} from '../utils/fetchWithTimeout.js';
import { INVALID_IMAGE_UPLOAD_RESPONSE, isAllowedImageUpload } from '../utils/imageSignature.js';

const router = Router();
const TOOL_UPSTREAM_TIMEOUT_MS = normalizeFetchTimeout(process.env.TOOL_UPSTREAM_TIMEOUT_MS);
const TOOL_UPSTREAM_MAX_BYTES = normalizeFetchResponseLimit(process.env.TOOL_UPSTREAM_MAX_BYTES);

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
const PHOTOROOM_ENV_KEYS = [
  'PHOTOROOM_API_KEY',
  'PHOTOROOM_KEY',
  'PHOTOROOM_APIKEY',
  'PHOTO_ROOM_API_KEY',
  'PHOTOROOM_SDK_API_KEY',
];
const getPhotoRoomApiKey = () => {
  for (const key of PHOTOROOM_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
};
const hasPhotoRoomConfig = () => Boolean(getPhotoRoomApiKey());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 21,
    fieldSize: 1024 * 1024,
  },
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
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 21,
    fieldSize: 1024 * 1024,
  },
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
    return res.status(503).json({ error: 'HEIF conversion service is unavailable' });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'image file is required' });
  }
  if (!isAllowedImageUpload(req.file, ['heif'])) {
    return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
  }

  let uploadResult = null;
  try {
    uploadResult = await uploadHeifAsJpg(req.file);
    const url = String(uploadResult?.secure_url || uploadResult?.url || '').trim();
    if (!url) {
      console.error('HEIF conversion failed: provider returned no output URL');
      return res.status(502).json({ error: 'HEIF conversion service returned no image' });
    }

    const convertedRes = await fetchWithTimeout(
      url,
      { method: 'GET' },
      { timeoutMs: TOOL_UPSTREAM_TIMEOUT_MS }
    );
    if (!convertedRes.ok) {
      await convertedRes.body?.cancel?.().catch?.(() => {});
      return res.status(502).json({ error: `Failed to download converted JPG (${convertedRes.status})` });
    }

    const { buffer, contentType } = await readBoundedResponseBuffer(convertedRes, {
      maxBytes: TOOL_UPSTREAM_MAX_BYTES,
      allowedContentTypes: ['image/jpeg', 'image/jpg'],
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'HEIF conversion failed',
      defaultStatus: 502,
      fallbackMessage: 'Failed to convert HEIF image',
    });
  } finally {
    if (uploadResult) {
      await tryCleanupUpload(uploadResult);
    }
  }
});

router.post('/remove-background', imageUpload.single('image'), async (req, res) => {
  const photoRoomApiKey = getPhotoRoomApiKey();
  if (!hasPhotoRoomConfig()) {
    return res.status(503).json({ error: 'Background removal service is unavailable' });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'image file is required' });
  }
  if (!isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) {
    return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
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

    const response = await fetchWithTimeout(
      'https://sdk.photoroom.com/v1/segment',
      {
        method: 'POST',
        headers: {
          Accept: 'image/png, image/webp, image/jpeg, application/json',
          'x-api-key': photoRoomApiKey,
        },
        body: form,
      },
      { timeoutMs: TOOL_UPSTREAM_TIMEOUT_MS }
    );

    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      console.error(
        `Background removal provider rejected request (${response.status})`,
        response.statusText
      );
      return res.status(502).json({ error: 'Background removal service rejected the image' });
    }

    const { buffer, contentType } = await readBoundedResponseBuffer(response, {
      maxBytes: TOOL_UPSTREAM_MAX_BYTES,
      allowedContentTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Background removal failed',
      defaultStatus: 502,
      fallbackMessage: 'Background removal failed',
    });
  }
});

export default router;
