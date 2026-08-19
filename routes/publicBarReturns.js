import crypto from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import BeverageItem from '../models/BeverageItem.js';
import { normalizePackoutItems } from './bar.js';
import { normalizeBarEventDate } from '../utils/barEventDates.js';
import { validateBarReturnQuantities } from '../utils/barEventAccounting.js';
import { recognizeDocuments } from '../utils/googleDocumentAi.js';
import { matchRecognizedItemsToCatalog, parseRecognizedPackout } from '../utils/barPackoutRecognition.js';
import { requiresBarReturn } from '../utils/barPackoutScope.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 60;
const MAX_BAD_PINS = 8;
const MAX_SCANS = 8;
const MAX_ITEMS = 250;
const MAX_FILES = 4;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const requestBuckets = new Map();
const badPinBuckets = new Map();
const scanBuckets = new Map();

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const normalizedName = (value) => clean(value, 240).toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const dedupeKey = (name, date) => `${normalizeBarEventDate(date)}:${normalizedName(name)}`;
const ipKey = (req) => clean(req.ip || req.socket?.remoteAddress || 'unknown', 120);

const increment = (map, key) => {
  const now = Date.now();
  if (map.size > 5000) {
    for (const [entryKey, bucket] of map) if (now - bucket.startedAt > WINDOW_MS) map.delete(entryKey);
  }
  let bucket = map.get(key);
  if (!bucket || now - bucket.startedAt > WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count;
};

const equalPin = (provided, configured) => {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(configured || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

export const safeGuestReturnsPinEqual = equalPin;
export const buildGuestEventDedupeKey = dedupeKey;

const requirePin = (req, res, next) => {
  const key = ipKey(req);
  if (increment(requestBuckets, key) > MAX_REQUESTS) {
    return res.status(429).json({ message: 'Too many requests. Wait a few minutes and try again.' });
  }
  const configured = clean(process.env.PUBLIC_BAR_RETURNS_PIN, 64);
  if (!configured) return res.status(503).json({ message: 'Guest returns are not configured' });
  const provided = clean(req.get('X-Bar-Returns-Pin'), 64);
  if (!equalPin(provided, configured)) {
    if (increment(badPinBuckets, key) > MAX_BAD_PINS) {
      return res.status(429).json({ message: 'Too many attempts. Wait a few minutes and try again.' });
    }
    return res.status(401).json({ message: 'Incorrect PIN' });
  }
  badPinBuckets.delete(key);
  res.setHeader('Cache-Control', 'no-store');
  return next();
};

const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 4, parts: MAX_FILES + 4 },
  fileFilter: (_req, file, callback) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const name = String(file?.originalname || '').toLowerCase();
    const allowed = /^(?:application\/pdf|image\/(?:jpeg|jpg|png|bmp|webp|tiff|gif))$/.test(mime)
      || /\.(?:pdf|jpe?g|png|bmp|webp|tiff?|gif)$/i.test(name);
    return allowed ? callback(null, true) : callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'files'));
  },
});

const publicItem = (item) => ({
  id: String(item?._id || ''),
  name: clean(item?.name, 240),
  section: clean(item?.section, 160),
  sentQty: Number(item?.sentQty || 0),
  sentQtyText: clean(item?.sentQtyText, 80),
  sentQtyPending: item?.sentQtyPending === true,
  returnedQty: Number(item?.returnedFullQty || 0) + Number(item?.returnedOpenQty || 0),
  returnConfirmed: item?.returnConfirmed === true,
  returnRequired: item?.included !== false && requiresBarReturn(item),
});

const publicEvent = (event) => ({
  id: String(event?._id || ''),
  name: clean(event?.name, 240),
  eventDate: clean(event?.eventDate, 80),
  venue: clean(event?.venue, 240),
  eventNumber: clean(event?.eventNumber, 80),
  status: clean(event?.status, 40),
  pendingReview: event?.guestIntake?.pendingReview === true,
  hasPackout: Array.isArray(event?.items) && event.items.length > 0,
  items: (Array.isArray(event?.items) ? event.items : []).map(publicItem),
});

const loadEditableEvent = async (req, res) => {
  if (!isObjectId(req.params.eventId)) {
    res.status(400).json({ message: 'Invalid event id' });
    return null;
  }
  const event = await BarEvent.findById(req.params.eventId);
  if (!event) {
    res.status(404).json({ message: 'Event not found' });
    return null;
  }
  if (['submitted', 'reviewed', 'closed'].includes(event.status)) {
    res.status(409).json({ message: 'Returns for this event have already been submitted' });
    return null;
  }
  return event;
};

const dashboardVenue = (event) => clean(
  event?.meta?.venue || event?.meta?.location || event?.meta?.eventVenue || event?.meta?.event_venue,
  240
);

const syncDashboardEvent = (event) => BarEvent.findOneAndUpdate(
  { linkedEventId: event._id },
  {
    $set: {
      name: clean(event.title, 240) || 'Untitled event',
      eventDate: normalizeBarEventDate(event.date) || clean(event.date, 80),
      client: clean(event.client, 180),
      venue: dashboardVenue(event),
    },
    $setOnInsert: { linkedEventId: event._id, status: 'draft', notes: '' },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);

router.use(requirePin);
router.post('/verify-pin', (_req, res) => res.json({ ok: true }));

// Deliberately requires an exact normalized name and exact date; no public event listing.
router.post('/find-event', async (req, res) => {
  try {
    const name = clean(req.body?.name, 240);
    const eventDate = normalizeBarEventDate(req.body?.eventDate);
    if (name.length < 2 || !eventDate) return res.status(400).json({ message: 'Event name and date are required' });
    const nameKey = normalizedName(name);
    const reports = await BarEvent.find({ eventDate }).limit(100);
    let event = reports.find((candidate) => normalizedName(candidate.name) === nameKey) || null;
    if (!event) {
      const dashboardCandidates = await Event.find({ status: { $not: /^deleted$/i } })
        .select('title date client meta').limit(500).lean();
      const dashboardEvent = dashboardCandidates.find((candidate) => (
        normalizeBarEventDate(candidate.date) === eventDate && normalizedName(candidate.title) === nameKey
      ));
      if (dashboardEvent) event = await syncDashboardEvent(dashboardEvent);
    }
    return res.json({ event: event ? publicEvent(event) : null });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest event lookup failed', fallbackMessage: 'Could not find this event' });
  }
});

router.post('/pending', async (req, res) => {
  try {
    const name = clean(req.body?.name, 240);
    const eventDate = normalizeBarEventDate(req.body?.eventDate);
    const reporterName = clean(req.body?.reporterName, 160);
    if (name.length < 2 || !eventDate || reporterName.length < 2) {
      return res.status(400).json({ message: 'Event name, date and your name are required' });
    }
    const key = dedupeKey(name, eventDate);
    let event = await BarEvent.findOne({ 'guestIntake.dedupeKey': key });
    if (!event) {
      event = await BarEvent.create({
        name,
        eventDate,
        venue: clean(req.body?.venue, 240),
        status: 'draft',
        guestIntake: { pendingReview: true, dedupeKey: key, reporterName, createdAt: new Date() },
        audit: [{ action: 'guest_pending_report_created', username: reporterName, at: new Date(), details: {} }],
      });
    }
    return res.json(publicEvent(event));
  } catch (error) {
    if (error?.code === 11000) {
      const event = await BarEvent.findOne({ 'guestIntake.dedupeKey': dedupeKey(req.body?.name, req.body?.eventDate) });
      if (event) return res.json(publicEvent(event));
    }
    return sendApiError(res, error, { context: 'Guest report creation failed', fallbackMessage: 'Could not create the pending report' });
  }
});

router.post('/:eventId/recognize', (req, res, next) => {
  if (increment(scanBuckets, ipKey(req)) > MAX_SCANS) {
    return res.status(429).json({ message: 'Too many scans. Wait a few minutes and try again.' });
  }
  return next();
}, scanUpload.array('files', MAX_FILES), async (req, res) => {
  try {
    const event = await loadEditableEvent(req, res);
    if (!event) return undefined;
    if (event.items.length) return res.status(409).json({ message: 'This event already has a packout' });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: 'Add a packout photo or PDF' });
    if (files.reduce((sum, file) => sum + Number(file?.size || 0), 0) > MAX_TOTAL_BYTES) {
      return res.status(413).json({ message: 'Packout files are too large in total' });
    }
    const documents = await recognizeDocuments(files);
    const parsed = parseRecognizedPackout({
      text: documents.map((document) => document.text).join('\n'),
      tables: documents.flatMap((document) => document.tables),
    });
    if (!parsed.items.length) return res.status(422).json({ message: 'No alcohol or bar rows were recognized' });
    const catalog = await BeverageItem.find({ active: { $ne: false } }).select('name aliases').lean();
    const items = matchRecognizedItemsToCatalog(parsed.items, catalog).slice(0, MAX_ITEMS).map((item) => ({
      name: clean(item.name, 240),
      section: clean(item.section, 160),
      scope: clean(item.scope, 30),
      quantity: Number(item.quantity ?? item.sentQty ?? 0),
      quantityText: clean(item.quantityText, 80),
      beverageItemId: item.beverageItemId ? String(item.beverageItemId) : null,
    }));
    return res.json({ items });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest packout recognition failed', defaultStatus: 502, fallbackMessage: 'Could not recognize this packout' });
  }
});

router.post('/:eventId/packout', async (req, res) => {
  try {
    const event = await loadEditableEvent(req, res);
    if (!event) return undefined;
    if (event.items.length) return res.status(409).json({ message: 'This event already has a packout' });
    const rows = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_ITEMS) : [];
    if (!rows.length) return res.status(400).json({ message: 'Add at least one item' });
    event.items = await normalizePackoutItems(rows.map((row) => ({
      ...row,
      sentQty: Number(row?.sentQty ?? row?.quantity ?? row?.returnedQty ?? 0),
      sentQtyPending: row?.sentQtyPending === true,
      included: true,
    })), { allowFinancials: false, guestCount: event.guestCount });
    if (!event.items.length) return res.status(422).json({ message: 'No alcohol or bar items were selected' });
    const reporterName = clean(req.body?.reporterName, 160);
    event.packout = {
      fileName: clean(req.body?.fileName, 240), contentType: clean(req.body?.contentType, 120),
      packoutType: 'bar_only', importedAt: new Date(), importedBy: reporterName,
    };
    event.status = 'ready';
    event.revision += 1;
    event.audit.push({ action: 'guest_packout_imported', username: reporterName, at: new Date(), details: { itemCount: event.items.length } });
    await event.save();
    return res.json(publicEvent(event));
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest packout import failed', fallbackMessage: 'Could not save this packout' });
  }
});

router.patch('/:eventId/returns', async (req, res) => {
  try {
    const event = await loadEditableEvent(req, res);
    if (!event) return undefined;
    const reporterName = clean(req.body?.reporterName, 160);
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    const required = event.items.filter((item) => item.included !== false && requiresBarReturn(item));
    if (reporterName.length < 2) return res.status(400).json({ message: 'Enter your name' });
    if (!required.length) return res.status(400).json({ message: 'This event has no returnable items' });
    if (required.some((item) => item.returnConfirmed === true)) {
      return res.status(409).json({ message: 'Returns for this event were already started. Ask a bar admin to review them.' });
    }
    if (rows.length !== required.length || rows.length > MAX_ITEMS) {
      return res.status(400).json({ message: 'Enter a returned quantity for every item' });
    }
    const byId = new Map(rows.map((row) => [clean(row?.itemId, 80), row]));
    const updates = [];
    for (const item of required) {
      const row = byId.get(String(item._id));
      const returnedQty = Number(row?.returnedQty);
      if (!row || !Number.isFinite(returnedQty) || returnedQty < 0) {
        return res.status(400).json({ message: `Enter a valid returned quantity for ${item.name}` });
      }
      const pendingSentQty = item.sentQtyPending === true ? Math.max(Number(item.sentQty || 0), returnedQty) : Number(item.sentQty || 0);
      const validation = validateBarReturnQuantities({
        ...item.toObject(),
        sentQty: pendingSentQty,
        returnedFullQty: 0,
        returnedOpenQty: returnedQty,
        lostDamagedQty: 0,
      });
      if (!validation.valid) return res.status(400).json({ message: `${item.name}: ${validation.message}` });
      updates.push({ item, returnedQty, pendingSentQty });
    }
    const now = new Date();
    updates.forEach(({ item, returnedQty, pendingSentQty }) => {
      if (item.sentQtyPending === true) item.sentQty = pendingSentQty;
      item.returnedFullQty = 0; item.returnedOpenQty = returnedQty; item.lostDamagedQty = 0;
      item.returnConfirmed = true; item.updatedBy = reporterName; item.updatedAt = now;
    });
    event.status = 'submitted';
    event.submittedAt = now;
    event.submittedBy = reporterName;
    event.guestIntake.reporterName = reporterName;
    event.guestIntake.lastSubmittedAt = now;
    event.revision += 1;
    event.audit.push({ action: 'guest_returns_submitted', username: reporterName, at: now, details: { count: updates.length } });
    await event.save();
    return res.json({ ok: true, event: publicEvent(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest returns submission failed', fallbackMessage: 'Could not submit returned quantities' });
  }
});

export default router;
