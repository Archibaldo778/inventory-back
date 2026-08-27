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
import { applyGuestReceivedRows } from '../utils/barGuestReturns.js';
import { barEventNumbersMatch, normalizeBarEventNumber } from '../utils/barChargeImport.js';

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
const MIN_EVENT_NAME_SIMILARITY = 0.6;
const AMBIGUOUS_SCORE_GAP = 0.05;

export const guestMutationWasApplied = (event, action, clientMutationId) => {
  const mutationId = clean(clientMutationId, 120);
  if (!mutationId) return false;
  return (Array.isArray(event?.audit) ? event.audit : []).some((entry) => (
    clean(entry?.action, 80) === action
    && clean(entry?.details?.clientMutationId, 120) === mutationId
  ));
};

const mutationDetails = (body, details = {}) => ({
  ...details,
  clientMutationId: clean(body?.clientMutationId, 120),
  clientDeviceId: clean(body?.clientDeviceId, 120),
  clientSavedAt: clean(body?.clientSavedAt, 80),
  queuedAt: clean(body?.queuedAt, 80),
});

const findAppliedGuestMutation = async (eventId, action, clientMutationId) => {
  const mutationId = clean(clientMutationId, 120);
  if (!mutationId || !isObjectId(eventId)) return null;
  return BarEvent.findOne({
    _id: eventId,
    audit: { $elemMatch: { action, 'details.clientMutationId': mutationId } },
  });
};

const levenshteinDistance = (left, right) => {
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
};

export const guestEventNameSimilarity = (leftValue, rightValue) => {
  const left = normalizedName(leftValue);
  const right = normalizedName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const characterScore = 1 - (levenshteinDistance(left, right) / Math.max(left.length, right.length));
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = (2 * sharedTokens) / (leftTokens.size + rightTokens.size);
  const queryCoverageScore = [...leftTokens].reduce((sum, queryToken) => {
    const bestTokenScore = [...rightTokens].reduce((best, candidateToken) => {
      const tokenScoreValue = 1 - (
        levenshteinDistance(queryToken, candidateToken) / Math.max(queryToken.length, candidateToken.length)
      );
      return Math.max(best, tokenScoreValue);
    }, 0);
    return sum + bestTokenScore;
  }, 0) / leftTokens.size;
  return Math.max(characterScore, tokenScore, queryCoverageScore);
};

export const selectGuestEventNameMatch = (query, candidates, getName = (candidate) => candidate?.name) => {
  const unique = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const key = normalizedName(getName(candidate));
    if (key && !unique.has(key)) unique.set(key, candidate);
  });
  const ranked = [...unique.values()]
    .map((candidate) => ({ candidate, score: guestEventNameSimilarity(query, getName(candidate)) }))
    .filter((entry) => entry.score >= MIN_EVENT_NAME_SIMILARITY)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return { match: null, ambiguous: false, score: 0 };
  const ambiguous = ranked.length > 1 && (ranked[0].score - ranked[1].score) < AMBIGUOUS_SCORE_GAP;
  return { match: ambiguous ? null : ranked[0].candidate, ambiguous, score: ranked[0].score };
};

export const selectGuestEventNumberMatch = (query, candidates, getNumber = (candidate) => candidate?.eventNumber || candidate?.externalId) => {
  const normalized = normalizeBarEventNumber(query);
  if (!normalized) return { match: null, ambiguous: false };
  const matches = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => barEventNumbersMatch(normalized, getNumber(candidate)));
  if (matches.length === 1) return { match: matches[0], ambiguous: false };
  const exact = matches.filter((candidate) => normalizeBarEventNumber(getNumber(candidate)) === normalized);
  if (exact.length === 1) return { match: exact[0], ambiguous: false };
  return { match: null, ambiguous: matches.length > 1 };
};

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

export const serializeGuestBarItem = (item) => ({
  id: String(item?._id || ''),
  name: clean(item?.name, 240),
  section: clean(item?.section, 160),
  included: item?.included !== false,
  sentQty: Number(item?.sentQty || 0),
  sentQtyText: clean(item?.sentQtyText, 80),
  sentQtyPending: item?.sentQtyPending === true,
  deliveredQty: item?.deliveredQty === null || item?.deliveredQty === undefined
    ? null
    : Number(item.deliveredQty),
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
  guestCount: Number.isFinite(Number(event?.guestCount)) ? Number(event.guestCount) : null,
  status: clean(event?.status, 40),
  revision: Number(event?.revision || 0),
  pendingReview: event?.guestIntake?.pendingReview === true,
  hasPackout: Array.isArray(event?.items) && event.items.length > 0,
  items: (Array.isArray(event?.items) ? event.items : []).map(serializeGuestBarItem),
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

const guestEventChoice = (event, source) => ({
  id: String(event?._id || ''),
  source,
  name: clean(source === 'dashboard' ? event?.title : event?.name, 240),
  eventDate: normalizeBarEventDate(source === 'dashboard' ? event?.date : event?.eventDate),
  venue: source === 'dashboard' ? dashboardVenue(event) : clean(event?.venue, 240),
  client: clean(event?.client, 180),
  eventNumber: clean(source === 'dashboard' ? event?.externalId : event?.eventNumber, 80),
});

export const filterGuestBarReportsForActiveEvents = (reports, dashboardEvents) => {
  const activeDashboardIds = new Set((Array.isArray(dashboardEvents) ? dashboardEvents : [])
    .map((event) => String(event?._id || ''))
    .filter(Boolean));
  return (Array.isArray(reports) ? reports : []).filter((report) => {
    const linkedEventId = String(report?.linkedEventId || '');
    return !linkedEventId || activeDashboardIds.has(linkedEventId);
  });
};

const dateChoices = (reports, dashboardEvents) => {
  const activeReports = filterGuestBarReportsForActiveEvents(reports, dashboardEvents);
  const linkedIds = new Set(activeReports.map((event) => String(event?.linkedEventId || '')).filter(Boolean));
  return [
    ...activeReports.map((event) => guestEventChoice(event, 'bar')),
    ...(dashboardEvents || [])
      .filter((event) => !linkedIds.has(String(event?._id || '')))
      .map((event) => guestEventChoice(event, 'dashboard')),
  ].sort((left, right) => left.name.localeCompare(right.name) || left.venue.localeCompare(right.venue));
};

export const buildGuestEventChoices = dateChoices;

const syncDashboardEvent = (event) => BarEvent.findOneAndUpdate(
  { linkedEventId: event._id },
  {
    $set: {
      name: clean(event.title, 240) || 'Untitled event',
      eventDate: normalizeBarEventDate(event.date) || clean(event.date, 80),
      client: clean(event.client, 180),
      venue: dashboardVenue(event),
      eventNumber: clean(event.externalId, 120),
    },
    $setOnInsert: { linkedEventId: event._id, status: 'draft', notes: '' },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);

router.use(requirePin);
router.post('/verify-pin', (_req, res) => res.json({ ok: true }));

router.post('/offline-events', async (_req, res) => {
  try {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    const dateString = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const reports = await BarEvent.find({
      eventDate: { $gte: dateString(from), $lte: dateString(to) },
      status: { $nin: ['reviewed', 'closed'] },
    }).sort({ eventDate: 1, name: 1 }).limit(200);
    const linkedIds = [...new Set(reports.map((event) => String(event?.linkedEventId || '')).filter(isObjectId))];
    const dashboardEvents = linkedIds.length
      ? await Event.find({ _id: { $in: linkedIds }, status: { $not: /^deleted$/i } }).select('_id').lean()
      : [];
    const events = filterGuestBarReportsForActiveEvents(reports, dashboardEvents);
    return res.json({ events: events.map(publicEvent) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Offline bar events load failed', fallbackMessage: 'Could not prepare offline events' });
  }
});

// The date must be exact. An ambiguous name returns the day's choices after PIN verification.
router.post('/find-event', async (req, res) => {
  try {
    const name = clean(req.body?.name, 240);
    const eventDate = normalizeBarEventDate(req.body?.eventDate);
    const requestedEventNumber = normalizeBarEventNumber(clean(req.body?.eventNumber, 120));
    if (requestedEventNumber) {
      const [reports, dashboardCandidates] = await Promise.all([
        BarEvent.find({ eventNumber: { $ne: '' } }).limit(500),
        Event.find({ externalId: { $ne: '' }, status: { $not: /^deleted$/i } })
          .select('title date client meta externalId').limit(500).lean(),
      ]);
      const choices = dateChoices(reports, dashboardCandidates);
      const numberMatch = selectGuestEventNumberMatch(requestedEventNumber, choices);
      if (numberMatch.ambiguous) return res.json({ event: null, events: choices.filter((choice) => barEventNumbersMatch(requestedEventNumber, choice.eventNumber)) });
      if (!numberMatch.match) return res.json({ event: null });
      let event = reports.find((candidate) => String(candidate._id) === numberMatch.match.id) || null;
      if (!event && numberMatch.match.source === 'dashboard') {
        const dashboardEvent = dashboardCandidates.find((candidate) => String(candidate._id) === numberMatch.match.id);
        if (dashboardEvent) event = await syncDashboardEvent(dashboardEvent);
      }
      return res.json({ event: event ? publicEvent(event) : null });
    }
    if (name.length < 2 || !eventDate) return res.status(400).json({ message: 'Enter an Event ID, or at least 2 name characters and an exact event date' });
    const [reports, dashboardCandidates] = await Promise.all([
      BarEvent.find({ eventDate }).limit(100),
      Event.find({ status: { $not: /^deleted$/i } }).select('title date client meta externalId').limit(500).lean(),
    ]);
    const sameDate = dashboardCandidates.filter((candidate) => normalizeBarEventDate(candidate.date) === eventDate);
    const choices = dateChoices(reports, sameDate);
    const choiceMatch = selectGuestEventNameMatch(name, choices);
    if (choiceMatch.ambiguous) return res.json({ event: null, events: choices });
    let event = null;
    if (choiceMatch.match?.source === 'bar') {
      event = reports.find((candidate) => String(candidate._id) === choiceMatch.match.id) || null;
    } else if (choiceMatch.match?.source === 'dashboard') {
      const dashboardEvent = sameDate.find((candidate) => String(candidate._id) === choiceMatch.match.id);
      if (dashboardEvent) event = await syncDashboardEvent(dashboardEvent);
    }
    return res.json({ event: event ? publicEvent(event) : null });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest event lookup failed', fallbackMessage: 'Could not find this event' });
  }
});

router.post('/select-event', async (req, res) => {
  try {
    const id = clean(req.body?.id, 80);
    const source = clean(req.body?.source, 20);
    const eventDate = normalizeBarEventDate(req.body?.eventDate);
    if (!isObjectId(id) || !eventDate || !['bar', 'dashboard'].includes(source)) {
      return res.status(400).json({ message: 'Choose a valid event' });
    }
    let event;
    if (source === 'bar') {
      event = await BarEvent.findOne({ _id: id, eventDate });
      if (event?.linkedEventId) {
        const activeDashboardEvent = await Event.exists({
          _id: event.linkedEventId,
          status: { $not: /^deleted$/i },
        });
        if (!activeDashboardEvent) event = null;
      }
    } else {
      const dashboardEvent = await Event.findOne({ _id: id, status: { $not: /^deleted$/i } })
        .select('title date client meta');
      if (dashboardEvent && normalizeBarEventDate(dashboardEvent.date) === eventDate) {
        event = await syncDashboardEvent(dashboardEvent);
      }
    }
    if (!event) return res.status(404).json({ message: 'Event was not found on this date' });
    return res.json({ event: publicEvent(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest event selection failed', fallbackMessage: 'Could not open this event' });
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
    if (req.body?.guestCount !== undefined && req.body.guestCount !== null) {
      const guestCount = Number(req.body.guestCount);
      if (!Number.isInteger(guestCount) || guestCount < 0) {
        return res.status(400).json({ message: 'Guest count must be a whole number of zero or greater' });
      }
      event.guestCount = guestCount;
      event.guestCountSource = 'packout';
    }
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

router.post('/:eventId/items', async (req, res) => {
  try {
    const event = await loadEditableEvent(req, res);
    if (!event) return undefined;
    if (event.items.length >= MAX_ITEMS) return res.status(413).json({ message: `This event is limited to ${MAX_ITEMS} items` });
    const reporterName = clean(req.body?.reporterName, 160);
    const name = clean(req.body?.name, 240);
    if (reporterName.length < 2) return res.status(400).json({ message: 'Enter your name' });
    if (name.length < 2) return res.status(400).json({ message: 'Enter the bottle name' });
    if (event.items.some((item) => normalizedName(item.name) === normalizedName(name))) {
      return res.status(409).json({ message: 'This bottle is already listed for the event' });
    }
    const sentQtyMissing = req.body?.sentQty === '' || req.body?.sentQty === null || req.body?.sentQty === undefined;
    const sentQty = sentQtyMissing ? 0 : Number(req.body.sentQty);
    if (!Number.isFinite(sentQty) || sentQty < 0) return res.status(400).json({ message: 'Enter a valid sent quantity or leave it blank' });
    const [item] = await normalizePackoutItems([{
      name,
      section: 'Captain added',
      scope: 'alcohol',
      included: true,
      sentQty,
      sentQtyText: sentQtyMissing ? 'Pending captain count' : String(sentQty),
      sentQtyPending: sentQtyMissing,
      entrySource: 'manual',
    }], { allowFinancials: false, guestCount: event.guestCount });
    if (!item) return res.status(422).json({ message: 'This row could not be added' });
    const now = new Date();
    item.entrySource = 'manual';
    item.updatedBy = reporterName;
    item.updatedAt = now;
    event.items.push(item);
    event.revision += 1;
    event.audit.push({ action: 'guest_item_added', username: reporterName, at: now, details: { name } });
    await event.save();
    return res.status(201).json({ ok: true, event: publicEvent(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest item creation failed', fallbackMessage: 'Could not add this bottle' });
  }
});

router.patch('/:eventId/received', async (req, res) => {
  try {
    const duplicate = await findAppliedGuestMutation(req.params.eventId, 'guest_received_saved', req.body?.clientMutationId);
    if (duplicate) return res.json({ ok: true, duplicate: true, event: publicEvent(duplicate) });
    const event = await loadEditableEvent(req, res);
    if (!event) return undefined;
    const reporterName = clean(req.body?.reporterName, 160);
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    const required = event.items.filter((item) => item.included !== false && requiresBarReturn(item));
    if (reporterName.length < 2) return res.status(400).json({ message: 'Enter your name' });
    if (!required.length) return res.status(400).json({ message: 'This event has no receivable items' });
    if (rows.length !== required.length || rows.length > MAX_ITEMS) {
      return res.status(400).json({ message: 'Enter a received quantity for every item' });
    }
    const now = new Date();
    const receivedResult = applyGuestReceivedRows(required, rows, { at: now, by: reporterName });
    if (!receivedResult.valid) return res.status(400).json({ message: receivedResult.message });
    if (event.status === 'draft' || event.status === 'ready') event.status = 'in_progress';
    event.guestIntake.reporterName = reporterName;
    event.revision += 1;
    event.audit.push({ action: 'guest_received_saved', username: reporterName, at: now, details: mutationDetails(req.body, { count: receivedResult.count }) });
    await event.save();
    return res.json({ ok: true, event: publicEvent(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest received quantities save failed', fallbackMessage: 'Could not save received quantities' });
  }
});

router.patch('/:eventId/returns', async (req, res) => {
  try {
    const duplicate = await findAppliedGuestMutation(req.params.eventId, 'guest_returns_submitted', req.body?.clientMutationId);
    if (duplicate) return res.json({ ok: true, duplicate: true, event: publicEvent(duplicate) });
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
      const deliveredQty = Number(row?.deliveredQty);
      const returnedQty = Number(row?.returnedQty);
      if (!row || !Number.isFinite(deliveredQty) || deliveredQty < 0) {
        return res.status(400).json({ message: `Enter a valid received quantity for ${item.name}` });
      }
      if (!row || !Number.isFinite(returnedQty) || returnedQty < 0) {
        return res.status(400).json({ message: `Enter a valid returned quantity for ${item.name}` });
      }
      const pendingSentQty = item.sentQtyPending === true
        ? Math.max(Number(item.sentQty || 0), deliveredQty, returnedQty)
        : Number(item.sentQty || 0);
      const validation = validateBarReturnQuantities({
        ...item.toObject(),
        sentQty: pendingSentQty,
        deliveredQty,
        returnedFullQty: 0,
        returnedOpenQty: returnedQty,
        lostDamagedQty: 0,
      });
      if (!validation.valid) return res.status(400).json({ message: `${item.name}: ${validation.message}` });
      updates.push({ item, deliveredQty, returnedQty, pendingSentQty });
    }
    const now = new Date();
    updates.forEach(({ item, deliveredQty, returnedQty, pendingSentQty }) => {
      if (item.sentQtyPending === true) item.sentQty = pendingSentQty;
      item.deliveredQty = deliveredQty;
      item.returnedFullQty = 0; item.returnedOpenQty = returnedQty; item.lostDamagedQty = 0;
      item.returnConfirmed = true; item.updatedBy = reporterName; item.updatedAt = now;
    });
    event.status = 'submitted';
    event.submittedAt = now;
    event.submittedBy = reporterName;
    event.guestIntake.reporterName = reporterName;
    event.guestIntake.lastSubmittedAt = now;
    event.revision += 1;
    event.audit.push({ action: 'guest_returns_submitted', username: reporterName, at: now, details: mutationDetails(req.body, { count: updates.length }) });
    await event.save();
    return res.json({ ok: true, event: publicEvent(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Guest returns submission failed', fallbackMessage: 'Could not submit returned quantities' });
  }
});

export default router;
