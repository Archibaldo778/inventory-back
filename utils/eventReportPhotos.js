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
  const data = await loadReportPhotoData(report);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(report.photos[index].contentType);
  return res.send(Buffer.from(data[index], 'base64'));
};
