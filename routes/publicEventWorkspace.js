import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import DropboxDocument from '../models/DropboxDocument.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';
import { isRestrictedEventDocument } from '../utils/eventFileVisibility.js';
import { buildDropboxPathDateRangePattern, findDropboxFolderEventMatch, inferDropboxEventFolderPath, inferDropboxPathDate, selectLatestDropboxFileRevisions } from '../utils/dropboxDocuments.js';
import { decryptDropboxSecret, downloadDropboxFile, listDropboxFolder, refreshDropboxAccessToken } from '../utils/dropboxApi.js';
import { resolveOperationalDropboxFolder } from '../utils/operationalDropbox.js';
import { convertLeadershipFileToPdf, isLeadershipPrintFileSupported } from '../utils/leadershipPrintPdf.js';

const router = Router();
const limiter = createMemoryRateLimiter({ windowMs: 60 * 1000, max: 120, message: 'Too many event file requests' });
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const tokenFrom = (req) => clean(req.query?.token || req.get('X-Event-Access'), 4096);

const requireViewAccess = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.eventId || ''))) return res.status(400).json({ message: 'Invalid event' });
  try {
    verifyEventGuestAccess(tokenFrom(req), req.params.eventId, 'operations:view');
    res.setHeader('Cache-Control', 'private, no-store');
    return next();
  } catch {
    return res.status(401).json({ message: 'This event link is invalid or expired' });
  }
};

const fileType = (name) => ({
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
})[clean(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]] || 'application/octet-stream';

const loadDropbox = async () => {
  const integration = await DropboxIntegration.findOne({ provider: 'dropbox', enabled: true })
    .select('+refreshToken.ciphertext +refreshToken.iv +refreshToken.tag').lean();
  if (!integration?.refreshToken?.ciphertext) throw Object.assign(new Error('Dropbox is not connected'), { statusCode: 409 });
  return { integration, accessToken: await refreshDropboxAccessToken(decryptDropboxSecret(integration.refreshToken)) };
};

const resolveFolder = async (event, integration) => {
  const direct = resolveOperationalDropboxFolder({ event, integration });
  if (direct.existing) return direct.folderPath;
  const date = clean(event.date, 10);
  const pattern = buildDropboxPathDateRangePattern(date, date);
  const candidates = await DropboxDocument.find({ status: { $ne: 'deleted' }, $or: [
    ...(date ? [{ inferredDate: date }] : []), ...(pattern ? [{ path: pattern }] : []),
  ] }).select('path name eventId inferredDate').limit(1000).lean();
  for (const document of candidates) {
    const match = findDropboxFolderEventMatch({ ...document, inferredDate: document.inferredDate || inferDropboxPathDate(document.path) }, [event]);
    if (match.status !== 'matched') continue;
    const folder = inferDropboxEventFolderPath(document.path);
    if (folder) return folder;
  }
  return direct.folderPath;
};

const inside = (path, folder) => {
  const normalizedPath = clean(path).replace(/\/+$/, '').toLowerCase();
  const normalizedFolder = clean(folder).replace(/\/+$/, '').toLowerCase();
  return Boolean(normalizedPath && normalizedFolder && normalizedPath.startsWith(`${normalizedFolder}/`));
};

const operationalFiles = async (event, token) => {
  const { integration, accessToken } = await loadDropbox();
  const folderPath = await resolveFolder(event, integration);
  let page;
  try { page = await listDropboxFolder(accessToken, { path: folderPath, namespaceId: integration.namespaceId || '' }); }
  catch (error) {
    if (Number(error?.statusCode) === 409 && /not_found|path\/not_found/i.test(String(error?.message || ''))) return { folderPath, files: [] };
    throw error;
  }
  const files = [];
  while (page) {
    for (const entry of Array.isArray(page.entries) ? page.entries : []) {
      if (entry?.['.tag'] !== 'file') continue;
      const path = clean(entry.path_display || entry.path_lower);
      const relativePath = path.slice(folderPath.length).replace(/^\/+/, '');
      if (!inside(path, folderPath) || /^~\$/i.test(clean(entry.name)) || isRestrictedEventDocument(relativePath)) continue;
      files.push({
        id: clean(entry.id || entry.path_lower || path), name: clean(entry.name || 'Event file'), relativePath,
        size: Number(entry.size || 0), modifiedAt: entry.server_modified || entry.client_modified || null,
        downloadUrl: `/api/public/event-workspace/${event._id}/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`,
        previewUrl: `/api/public/event-workspace/${event._id}/preview?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`,
      });
    }
    page = page.has_more ? await listDropboxFolder(accessToken, { cursor: page.cursor, namespaceId: integration.namespaceId || '' }) : null;
  }
  return { folderPath, files: selectLatestDropboxFileRevisions(files).sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true })) };
};

router.get('/:eventId', limiter, requireViewAccess, async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.eventId, status: { $not: /^deleted$/i } })
      .select('externalId title date client managerId meta').lean();
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const dropbox = await operationalFiles(event, tokenFrom(req));
    return res.json({
      event: {
        id: String(event._id), eventNumber: clean(event.externalId, 100), title: clean(event.title, 240), date: clean(event.date, 30),
        client: clean(event.client, 160), venue: clean(event.meta?.venue || event.meta?.location || event.meta?.eventVenue, 240),
        salesManager: clean(event.meta?.salesRep || event.meta?.caterease?.salesRep || event.managerId, 160),
      },
      folderPath: dropbox.folderPath,
      files: dropbox.files,
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event workspace failed', defaultStatus: 502, fallbackMessage: 'Could not load the event workspace' });
  }
});

router.get('/:eventId/file', limiter, requireViewAccess, async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).select('externalId title date').lean();
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const { integration, accessToken } = await loadDropbox();
    const folder = await resolveFolder(event, integration);
    const path = clean(req.query?.path);
    const relativePath = path.slice(folder.length).replace(/^\/+/, '');
    if (!inside(path, folder) || isRestrictedEventDocument(relativePath)) return res.status(404).json({ message: 'File not available' });
    const buffer = await downloadDropboxFile(accessToken, path, { namespaceId: integration.namespaceId || '' });
    const name = path.split('/').filter(Boolean).at(-1) || 'event-file';
    res.type(fileType(name)); res.attachment(name); return res.send(buffer);
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event file failed', defaultStatus: 502, fallbackMessage: 'Could not download this file' });
  }
});

router.get('/:eventId/preview', limiter, requireViewAccess, async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).select('externalId title date').lean();
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const { integration, accessToken } = await loadDropbox();
    const folder = await resolveFolder(event, integration);
    const path = clean(req.query?.path);
    const relativePath = path.slice(folder.length).replace(/^\/+/, '');
    if (!inside(path, folder) || isRestrictedEventDocument(relativePath)) return res.status(404).json({ message: 'File not available' });
    const name = path.split('/').filter(Boolean).at(-1) || 'event-file';
    const mime = fileType(name);
    const source = await downloadDropboxFile(accessToken, path, { namespaceId: integration.namespaceId || '' });
    if (source.length > 25 * 1024 * 1024) return res.status(413).json({ message: 'This file is too large to preview' });
    res.setHeader('Cache-Control', 'private, no-store');
    if (mime.startsWith('image/')) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
      return res.send(source);
    }
    if (!isLeadershipPrintFileSupported(name)) return res.status(415).json({ message: 'Preview is not available for this file type' });
    const pdf = await convertLeadershipFileToPdf({ fileName: name, buffer: source });
    const previewName = `${name.replace(/\.[^.]+$/, '')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(previewName)}`);
    return res.send(pdf);
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event preview failed', defaultStatus: 502, fallbackMessage: 'Could not prepare this preview' });
  }
});

export default router;
