import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { PDFDocument } from 'pdf-lib';
import EventReport from '../models/EventReport.js';
import { createApiError } from './apiErrors.js';

export const MAX_REPORT_PHOTOS = 10;
export const MAX_REPORT_PHOTO_BYTES = 1024 * 1024;
export const validateReportPhotos = async (input = []) => {
  if (!Array.isArray(input) || input.length > MAX_REPORT_PHOTOS) throw createApiError(400, 'Attach up to 10 photos');
  const photos = []; const photoData = [];
  const pdf = await PDFDocument.create();
  for (const [index, photo] of input.entries()) {
    const data = photo?.data;
    if (typeof data !== 'string' || data.length > Math.ceil(MAX_REPORT_PHOTO_BYTES / 3) * 4) throw createApiError(413, 'Each photo must be 1 MB or smaller');
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw createApiError(400, 'Invalid photo');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_REPORT_PHOTO_BYTES) throw createApiError(413, 'Each photo must be 1 MB or smaller');
    const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg) throw createApiError(400, 'Choose JPEG or PNG photos');
    if (png && bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 20_000_000) throw createApiError(400, 'Photo dimensions are too large');
    try {
      const image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      if (!image.width || !image.height || image.width * image.height > 20_000_000) throw Error('dimensions');
    } catch { throw createApiError(400, 'This photo cannot be read. Choose another JPEG or PNG image'); }
    photos.push({ fileName: `photo-${index + 1}.${png ? 'png' : 'jpg'}`, contentType: png ? 'image/png' : 'image/jpeg', size: bytes.length });
    photoData.push(bytes.toString('base64'));
  }
  return { photos, photoData };
};

export const loadReportPhotoData = async (report) => {
  if (!report?.photos?.length) return [];
  const data = report.photoData || (await EventReport.findById(report._id).select('+photoData').lean())?.photoData;
  if (!Array.isArray(data) || data.length !== report.photos.length) throw createApiError(500, 'Report photos could not be loaded');
  return data;
};

export const sendReportPhoto = async (res, report, index) => {
  if (!/^\d+$/.test(String(index)) || !report?.photos?.[Number(index)]) throw createApiError(404, 'Photo not found');
  if (report.photos[index].url) {
    const url = cloudReportPhotoUrl(report.photos[index]);
    if (!url) throw createApiError(404, 'Photo not found');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.redirect(url);
  }
  const data = await loadReportPhotoData(report);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(report.photos[index].contentType);
  return res.send(Buffer.from(data[index], 'base64'));
};

const REPORT_PHOTO_STORAGE_BYTES = 100 * 1024 * 1024;
export const cloudReportPhotoUrl = (photo) => {
  try {
    const url = new URL(photo?.url);
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

export const uploadReportPhoto = async ({ report, data, upload, Report = EventReport }) => {
  if (report.status !== 'pending') throw createApiError(409, 'This report is no longer open for photos');
  const validated = await validateReportPhotos([{ data }]);
  const bytes = Buffer.from(validated.photoData[0], 'base64');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const publicId = `event-reports/${report._id}/${digest}`;
  const existing = report.photos?.find((photo) => photo.publicId === publicId);
  if (existing) return existing;
  if ((report.photos || []).reduce((sum, photo) => sum + Number(photo.size || 0), 0) + bytes.length > REPORT_PHOTO_STORAGE_BYTES) {
    throw createApiError(413, 'This report has reached its photo storage capacity. Contact your administrator.');
  }
  if (!upload) {
    cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
    upload = (buffer, options) => new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(options, (error, result) => error ? reject(error) : resolve(result)).end(buffer);
    });
  }
  const result = await upload(bytes, { public_id: publicId, resource_type: 'image', overwrite: false, format: 'jpg', transformation: [{ width: 1600, height: 1600, crop: 'limit' }, { quality: 'auto:good' }] });
  const photo = { publicId, url: result.secure_url, fileName: `photo-${digest.slice(0, 12)}.jpg`, contentType: 'image/jpeg', size: bytes.length };
  if (!cloudReportPhotoUrl(photo)) throw createApiError(502, 'Photo storage did not return a valid image');
  const updated = await Report.findOneAndUpdate({ _id: report._id, status: 'pending', 'photos.publicId': { $ne: publicId },
    $expr: { $lte: [{ $add: [{ $sum: '$photos.size' }, bytes.length] }, REPORT_PHOTO_STORAGE_BYTES] },
  }, { $push: { photos: photo } }, { new: true });
  if (!updated) {
    const current = await Report.findById(report._id);
    const saved = current?.photos?.find((item) => item.publicId === publicId);
    if (saved) return saved;
    throw createApiError(409, 'Photo was not attached. Reload the report before trying again.');
  }
  return photo;
};

export const reportPhotoEmailContent = (report) => {
  const photos = (report.photos || []).map((photo, index) => ({ url: cloudReportPhotoUrl(photo), index })).filter((photo) => photo.url);
  const escape = (url) => url.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return {
    html: photos.length ? `<h2>Photos</h2>${photos.map(({ url, index }, order) => `<p><a href="${escape(url)}">${order < 10 ? `<img src="${escape(url.replace('/image/upload/', '/image/upload/c_limit,w_480,h_360,q_auto/'))}" width="240" alt="Photo ${index + 1}" style="max-width:100%;height:auto"/><br/>` : ''}View photo ${index + 1}</a></p>`).join('')}` : '',
    text: photos.length ? `\n\nPhotos\n${photos.map(({ url, index }) => `Photo ${index + 1}: ${url}`).join('\n')}` : '',
  };
};
