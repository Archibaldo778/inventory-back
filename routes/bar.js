import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import BarEvent, { BAR_EVENT_STATUSES, BAR_ITEM_SCOPES, BAR_PRICE_UNITS } from '../models/BarEvent.js';
import BarPackage from '../models/BarPackage.js';
import BeverageItem from '../models/BeverageItem.js';
import Event from '../models/Event.js';
import { isAdminAuth, normalizeRole } from '../middleware/auth.js';
import {
  calculateBarEventAccounting,
  calculateBarItemAccounting,
  validateBarReturnQuantities,
} from '../utils/barEventAccounting.js';
import { normalizeBarEventDate } from '../utils/barEventDates.js';
import { sendApiError } from '../utils/apiErrors.js';
import { recognizeDocuments } from '../utils/googleDocumentAi.js';
import {
  keepBarAccountingItems,
  matchRecognizedItemsToCatalog,
  parseRecognizedPackout,
} from '../utils/barPackoutRecognition.js';
import {
  getPreparedBeverageRate,
  getPreparedBeverageType,
  requiresBarReturn,
} from '../utils/barPackoutScope.js';

const router = Router();
const BAR_MANAGER_ROLES = new Set(['bar admin']);
const BAR_WORKER_ROLES = new Set(['bar captain', 'bartender']);
const BAR_VIEWER_ROLES = new Set(['user', 'manager', 'sales rep']);
const MAX_PACKOUT_ITEMS = 500;
const MAX_AUDIT_ENTRIES = 200;
const MAX_SCAN_FILES = 6;
const MAX_SCAN_FILE_BYTES = 12 * 1024 * 1024;
const MAX_SCAN_TOTAL_BYTES = 40 * 1024 * 1024;
const SCAN_RATE_WINDOW_MS = 10 * 60 * 1000;
const SCAN_RATE_MAX = 20;
const scanRateBuckets = new Map();

const packoutScanUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_SCAN_FILES,
    fileSize: MAX_SCAN_FILE_BYTES,
    fields: 5,
    parts: MAX_SCAN_FILES + 5,
  },
  fileFilter: (_req, file, callback) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    const name = String(file?.originalname || '').toLowerCase();
    const allowed = /^(?:application\/pdf|image\/(?:jpeg|jpg|png|bmp|webp|tiff|gif))$/.test(mime)
      || /\.(?:pdf|jpe?g|png|bmp|webp|tiff?|gif)$/i.test(name);
    if (allowed) return callback(null, true);
    return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'files'));
  },
});

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const cleanString = (value, maxLength = 500) => String(value ?? '').trim().slice(0, maxLength);
const cleanNumber = (value, { fallback = null, min = 0 } = {}) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min) return fallback;
  return numeric;
};
const cleanBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const isBarManager = (auth) => (
  isAdminAuth(auth) || BAR_MANAGER_ROLES.has(normalizeRole(auth?.role))
);

const isBarWorker = (auth) => BAR_WORKER_ROLES.has(normalizeRole(auth?.role));

const canViewEvent = (_event, auth) => (
  isBarManager(auth)
  || BAR_VIEWER_ROLES.has(normalizeRole(auth?.role))
  || isBarWorker(auth)
);

const canOperateEvent = (_event, auth) => (
  isBarManager(auth) || isBarWorker(auth)
);

const addAudit = (event, auth, action, details = {}) => {
  event.audit.push({
    action,
    userId: String(auth?.userId || ''),
    username: String(auth?.username || auth?.email || ''),
    at: new Date(),
    details,
  });
  if (event.audit.length > MAX_AUDIT_ENTRIES) {
    event.audit.splice(0, event.audit.length - MAX_AUDIT_ENTRIES);
  }
};

const serializeBarEvent = (source, { includeFinancials = false } = {}) => {
  const event = typeof source?.toObject === 'function' ? source.toObject() : { ...(source || {}) };
  const totals = calculateBarEventAccounting(event);
  event.items = (Array.isArray(event.items) ? event.items : []).map((item) => {
    const next = {
      ...item,
      accounting: calculateBarItemAccounting(item),
    };
    if (!includeFinancials) {
      delete next.unitCostSnapshot;
      if (next.accounting) {
        delete next.accounting.unitCost;
        delete next.accounting.actualCost;
      }
    }
    return next;
  });
  if (includeFinancials) {
    event.totals = totals;
  } else {
    event.packageSnapshot = event.packageSnapshot?.name
      ? { name: event.packageSnapshot.name }
      : {};
    delete event.clientCharge;
    delete event.currency;
    delete event.audit;
    event.progress = {
      includedItemCount: totals.includedItemCount,
      confirmedItemCount: totals.confirmedItemCount,
    };
  }
  delete event.assignedUserIds;
  return event;
};

const requireBarManager = (req, res, next) => {
  if (!isBarManager(req.auth)) return res.status(403).json({ message: 'Bar admin access required' });
  return next();
};

const requireBarOperator = (req, res, next) => {
  if (!isBarManager(req.auth) && !isBarWorker(req.auth)) {
    return res.status(403).json({ message: 'Bar operation access required' });
  }
  return next();
};

const limitPackoutRecognition = (req, res, next) => {
  const now = Date.now();
  if (scanRateBuckets.size > 5000) {
    for (const [key, bucket] of scanRateBuckets) {
      if ((now - bucket.startedAt) > SCAN_RATE_WINDOW_MS) scanRateBuckets.delete(key);
    }
  }
  const key = String(req.auth?.userId || req.ip || 'unknown');
  let bucket = scanRateBuckets.get(key);
  if (!bucket || (now - bucket.startedAt) > SCAN_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    scanRateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > SCAN_RATE_MAX) {
    return res.status(429).json({ message: 'Too many packout scans. Wait a few minutes and try again.' });
  }
  return next();
};

const loadEvent = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400).json({ message: 'Invalid bar report id' });
    return null;
  }
  const event = await BarEvent.findById(req.params.id);
  if (!event) {
    res.status(404).json({ message: 'Event bar report not found' });
    return null;
  }
  return event;
};

const eventVenue = (event) => cleanString(
  event?.meta?.venue
  || event?.meta?.location
  || event?.meta?.eventVenue
  || event?.meta?.event_venue,
  240
);

const eventGuestCount = (event) => cleanNumber(
  event?.meta?.guestCount
  ?? event?.meta?.guest_count
  ?? event?.meta?.guests,
  { fallback: null }
);

const syncDashboardEventsToBar = async ({ eventId = null } = {}) => {
  const query = {
    status: { $not: /^deleted$/i },
    ...(eventId && isObjectId(eventId) ? { _id: eventId } : {}),
  };
  const dashboardEvents = await Event.find(query).lean();
  if (!dashboardEvents.length) return;
  const linkedIds = dashboardEvents.map((event) => event._id);
  const existingReports = await BarEvent.find({ linkedEventId: { $in: linkedIds } })
    .select('linkedEventId name eventDate client venue guestCount')
    .lean();
  const existingByEventId = new Map(
    existingReports.map((report) => [String(report.linkedEventId), report])
  );
  const operations = dashboardEvents.flatMap((event) => {
    const next = {
      name: cleanString(event.title, 240) || 'Untitled event',
      eventDate: normalizeBarEventDate(event.date) || cleanString(event.date, 80),
      client: cleanString(event.client, 180),
      venue: eventVenue(event),
      guestCount: eventGuestCount(event),
    };
    const current = existingByEventId.get(String(event._id));
    const unchanged = current
      && String(current.name || '') === next.name
      && String(current.eventDate || '') === next.eventDate
      && String(current.client || '') === next.client
      && String(current.venue || '') === next.venue
      && (current.guestCount ?? null) === next.guestCount;
    if (unchanged) return [];
    return [{
    updateOne: {
      filter: { linkedEventId: event._id },
      update: {
        $set: next,
        $setOnInsert: {
          linkedEventId: event._id,
          status: 'draft',
          notes: '',
        },
      },
      upsert: true,
    },
  }];
  });
  if (operations.length) {
    await BarEvent.bulkWrite(operations, { ordered: false });
  }
};

const normalizePackage = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const priceUnitCandidate = cleanString(source.priceUnit ?? previous.priceUnit, 30);
  const optionalNumber = (field) => {
    if (Object.prototype.hasOwnProperty.call(source, field) && (source[field] === null || source[field] === '')) {
      return null;
    }
    return cleanNumber(source[field], {
      fallback: cleanNumber(previous[field], { fallback: null }),
    });
  };
  return {
    name: cleanString(source.name ?? previous.name, 160),
    baseRate: cleanNumber(source.baseRate, {
      fallback: cleanNumber(previous.baseRate, { fallback: 0 }),
    }),
    overrideRate: optionalNumber('overrideRate'),
    priceUnit: BAR_PRICE_UNITS.includes(priceUnitCandidate) ? priceUnitCandidate : 'flat',
    additionalHourRate: cleanNumber(source.additionalHourRate, {
      fallback: cleanNumber(previous.additionalHourRate, { fallback: 0 }),
    }),
    serviceHours: optionalNumber('serviceHours'),
    includedHours: optionalNumber('includedHours'),
    pricingQuantity: optionalNumber('pricingQuantity'),
  };
};

const normalizePackageTemplate = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const priceUnitCandidate = cleanString(source.priceUnit ?? previous.priceUnit, 30);
  return {
    name: cleanString(source.name ?? previous.name, 160),
    baseRate: cleanNumber(source.baseRate, {
      fallback: cleanNumber(previous.baseRate, { fallback: 0 }),
    }),
    priceUnit: BAR_PRICE_UNITS.includes(priceUnitCandidate) ? priceUnitCandidate : 'flat',
    additionalHourRate: cleanNumber(source.additionalHourRate, {
      fallback: cleanNumber(previous.additionalHourRate, { fallback: 0 }),
    }),
    defaultServiceHours: cleanNumber(source.defaultServiceHours, {
      fallback: cleanNumber(previous.defaultServiceHours, { fallback: null }),
    }),
    active: source.active === undefined
      ? cleanBoolean(previous.active, true)
      : cleanBoolean(source.active, true),
    notes: cleanString(source.notes ?? previous.notes, 1000),
  };
};

router.get('/packages', requireBarManager, async (_req, res) => {
  try {
    const packages = await BarPackage.find().sort({ active: -1, name: 1 });
    return res.json(packages);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar packages list failed',
      fallbackMessage: 'Failed to list bar packages',
    });
  }
});

router.post('/packages', requireBarManager, async (req, res) => {
  try {
    const payload = normalizePackageTemplate(req.body);
    if (!payload.name) return res.status(400).json({ message: 'Package name is required' });
    const created = await BarPackage.create(payload);
    return res.status(201).json(created);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar package creation failed',
      fallbackMessage: error?.code === 11000 ? 'A package with this name already exists' : 'Failed to create bar package',
    });
  }
});

router.patch('/packages/:packageId', requireBarManager, async (req, res) => {
  try {
    if (!isObjectId(req.params.packageId)) {
      return res.status(400).json({ message: 'Invalid bar package id' });
    }
    const current = await BarPackage.findById(req.params.packageId);
    if (!current) return res.status(404).json({ message: 'Bar package not found' });
    const payload = normalizePackageTemplate(req.body, current.toObject());
    if (!payload.name) return res.status(400).json({ message: 'Package name is required' });
    Object.assign(current, payload);
    await current.save();
    return res.json(current);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar package update failed',
      fallbackMessage: error?.code === 11000 ? 'A package with this name already exists' : 'Failed to update bar package',
    });
  }
});

router.delete('/packages/:packageId', requireBarManager, async (req, res) => {
  try {
    if (!isObjectId(req.params.packageId)) {
      return res.status(400).json({ message: 'Invalid bar package id' });
    }
    const deleted = await BarPackage.findByIdAndDelete(req.params.packageId);
    if (!deleted) return res.status(404).json({ message: 'Bar package not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar package deletion failed',
      fallbackMessage: 'Failed to delete bar package',
    });
  }
});

const normalizeCatalogName = (value) => cleanString(value, 240)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const resolveCatalogUnitCost = (item) => {
  const purchaseCost = cleanNumber(item?.purchaseCost, { fallback: null });
  const caseCost = cleanNumber(item?.caseCost, { fallback: null });
  const caseSize = cleanNumber(item?.caseSize, { fallback: null, min: 1 });
  if (purchaseCost !== null && purchaseCost > 0) return purchaseCost;
  if (caseCost !== null && caseCost > 0 && caseSize) return caseCost / caseSize;
  return purchaseCost ?? 0;
};

const resolveCatalog = async (items) => {
  const ids = [...new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item?.beverageItemId || '').trim())
    .filter(isObjectId))];
  const names = new Set((Array.isArray(items) ? items : [])
    .map((item) => normalizeCatalogName(item?.name))
    .filter(Boolean));
  const query = ids.length
    ? {
        active: { $ne: false },
        $or: [{ _id: { $in: ids } }, { name: { $exists: true, $ne: '' } }],
      }
    : { name: { $exists: true, $ne: '' }, active: { $ne: false } };
  const catalog = await BeverageItem.find(query)
    .select('name aliases sku bottleSizeMl caseSize +purchaseCost +caseCost');
  const byId = new Map();
  const byName = new Map();
  catalog.forEach((item) => {
    byId.set(String(item._id), item);
    const nameKey = normalizeCatalogName(item.name);
    if (nameKey && names.has(nameKey) && !byName.has(nameKey)) byName.set(nameKey, item);
    (Array.isArray(item.aliases) ? item.aliases : []).forEach((alias) => {
      const aliasKey = normalizeCatalogName(alias);
      if (aliasKey && names.has(aliasKey) && !byName.has(aliasKey)) byName.set(aliasKey, item);
    });
  });
  return { byId, byName };
};

const normalizePackoutItems = async (items, { allowFinancials = false, guestCount = null } = {}) => {
  const source = keepBarAccountingItems(Array.isArray(items) ? items.slice(0, MAX_PACKOUT_ITEMS) : []);
  const catalog = await resolveCatalog(source);
  return source
    .map((item) => {
      const requestedCatalogId = isObjectId(item?.beverageItemId) ? String(item.beverageItemId) : null;
      const catalogItem = (requestedCatalogId ? catalog.byId.get(requestedCatalogId) : null)
        || catalog.byName.get(normalizeCatalogName(item?.name))
        || null;
      const beverageItemId = catalogItem?._id || requestedCatalogId || null;
      const catalogUnitCost = resolveCatalogUnitCost(catalogItem);
      const scope = BAR_ITEM_SCOPES.includes(cleanString(item?.scope, 30))
        ? cleanString(item.scope, 30)
        : 'review';
      const preparedBeverageType = getPreparedBeverageType(item);
      const preparedRate = getPreparedBeverageRate(item);
      const sentQty = cleanNumber(item?.sentQty ?? item?.quantity, {
        fallback: preparedBeverageType ? cleanNumber(guestCount, { fallback: 0 }) : 0,
      });
      return {
        beverageItemId,
        name: cleanString(item?.name || catalogItem?.name, 240),
        section: cleanString(item?.section, 160),
        scope,
        included: cleanBoolean(item?.included ?? item?.includedByDefault, scope !== 'non_bar'),
        sentQty,
        sentQtyText: cleanString(item?.sentQtyText ?? item?.quantityText ?? sentQty, 80),
        deliveredQty: cleanNumber(item?.deliveredQty ?? item?.delivered, { fallback: null }),
        returnedFullQty: cleanNumber(item?.returnedFullQty, { fallback: 0 }),
        returnedOpenQty: cleanNumber(item?.returnedOpenQty, { fallback: 0 }),
        lostDamagedQty: cleanNumber(item?.lostDamagedQty, { fallback: 0 }),
        returnConfirmed: preparedBeverageType ? true : cleanBoolean(item?.returnConfirmed, false),
        unitCostSnapshot: preparedRate ?? (allowFinancials
          ? cleanNumber(item?.unitCostSnapshot, {
            fallback: catalogUnitCost,
          })
          : catalogUnitCost),
        bottleSizeMl: cleanNumber(item?.bottleSizeMl, {
          fallback: cleanNumber(catalogItem?.bottleSizeMl, { fallback: null }),
        }),
        notes: cleanString(item?.notes, 1000),
        captainNotes: cleanString(item?.captainNotes, 1000),
      };
    })
    .filter((item) => item.name);
};

router.get('/events', async (req, res) => {
  try {
    if (!isBarManager(req.auth) && !isBarWorker(req.auth) && !BAR_VIEWER_ROLES.has(normalizeRole(req.auth?.role))) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    await syncDashboardEventsToBar();
    const query = {};
    if (req.query.status && BAR_EVENT_STATUSES.includes(String(req.query.status))) {
      query.status = String(req.query.status);
    }
    const events = await BarEvent.find(query).sort({ eventDate: -1, createdAt: -1 });
    return res.json(events.map((event) => serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    })));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar reports list failed',
      fallbackMessage: 'Failed to list event bar reports',
    });
  }
});

router.get('/events/by-linked/:linkedEventId', async (req, res) => {
  try {
    if (!isObjectId(req.params.linkedEventId)) {
      return res.status(400).json({ message: 'Invalid dashboard event id' });
    }
    await syncDashboardEventsToBar({ eventId: req.params.linkedEventId });
    const event = await BarEvent.findOne({ linkedEventId: req.params.linkedEventId });
    if (!event) return res.status(404).json({ message: 'Event bar report not found' });
    if (!canViewEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    return res.json(serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Linked event bar report lookup failed',
      fallbackMessage: 'Failed to load the event bar report',
    });
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canViewEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    return res.json(serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar report lookup failed',
      fallbackMessage: 'Failed to load the event bar report',
    });
  }
});

router.patch('/events/:id', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    const textFields = [
      'eventNumber',
      'name',
      'eventDate',
      'client',
      'venue',
      'salesRep',
      'eventTiming',
      'deliveryTime',
      'notes',
    ];
    textFields.forEach((field) => {
      if (req.body?.[field] !== undefined) {
        event[field] = cleanString(req.body[field], field === 'notes' ? 3000 : 240);
      }
    });
    if (!event.name) return res.status(400).json({ message: 'Event name is required' });
    if (req.body?.guestCount !== undefined) {
      event.guestCount = cleanNumber(req.body.guestCount, { fallback: null });
    }
    if (req.body?.packageSnapshot !== undefined) {
      event.packageSnapshot = normalizePackage(req.body.packageSnapshot, event.packageSnapshot);
    }
    if (req.body?.clientCharge !== undefined) {
      event.clientCharge = cleanNumber(req.body.clientCharge, { fallback: 0 });
    }
    if (req.body?.currency !== undefined) {
      event.currency = cleanString(req.body.currency, 10) || 'USD';
    }
    if (req.body?.status !== undefined && BAR_EVENT_STATUSES.includes(String(req.body.status))) {
      event.status = String(req.body.status);
    }
    event.revision += 1;
    addAudit(event, req.auth, 'event_updated');
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: true }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar report update failed',
      fallbackMessage: 'Failed to update the event bar report',
    });
  }
});

router.post('/events/:id/packout/match', requireBarOperator, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    const manager = isBarManager(req.auth);
    if (!manager && event.items.length > 0) {
      return res.status(409).json({ message: 'A packout already exists. Ask a bar admin to replace it.' });
    }
    const sourceItems = keepBarAccountingItems(
      Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_PACKOUT_ITEMS) : []
    );
    if (!sourceItems.length) {
      return res.status(422).json({ message: 'No alcohol, cocktails or mocktails were found in this packout' });
    }
    const catalog = await BeverageItem.find({ active: { $ne: false } })
      .select('name aliases')
      .lean();
    const items = matchRecognizedItemsToCatalog(sourceItems, catalog);
    return res.json({
      items,
      matchedCount: items.filter((item) => item.beverageItemId).length,
      suggestedCount: items.filter((item) => item.catalogMatch?.status === 'suggested').length,
      unmatchedCount: items.filter((item) => item.catalogMatch?.status === 'unmatched').length,
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar packout inventory matching failed',
      fallbackMessage: 'Packout inventory matching failed',
    });
  }
});

router.post(
  '/events/:id/packout/recognize',
  requireBarOperator,
  limitPackoutRecognition,
  packoutScanUpload.array('files', MAX_SCAN_FILES),
  async (req, res) => {
    try {
      const event = await loadEvent(req, res);
      if (!event) return undefined;
      const manager = isBarManager(req.auth);
      if (!manager && event.items.length > 0) {
        return res.status(409).json({ message: 'A packout already exists. Ask a bar admin to replace it.' });
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ message: 'Add at least one packout photo or PDF' });
      const totalBytes = files.reduce((sum, file) => sum + Number(file?.size || 0), 0);
      if (totalBytes > MAX_SCAN_TOTAL_BYTES) {
        return res.status(413).json({ message: 'Packout scan files are too large in total' });
      }
      const documents = await recognizeDocuments(files);
      const parsed = parseRecognizedPackout({
        text: documents.map((document) => document.text).join('\n'),
        tables: documents.flatMap((document) => document.tables),
      });
      if (!parsed.items.length) {
        return res.status(422).json({ message: 'No packout rows were recognized. Retake the photo straight-on in brighter light.' });
      }
      const catalog = await BeverageItem.find({ active: { $ne: false } })
        .select('name aliases')
        .lean();
      const items = matchRecognizedItemsToCatalog(parsed.items, catalog);
      return res.json({
        ...parsed,
        items,
        provider: 'google_document_ai',
        matchedCount: items.filter((item) => item.beverageItemId).length,
        suggestedCount: items.filter((item) => item.catalogMatch?.status === 'suggested').length,
      });
    } catch (error) {
      return sendApiError(res, error, {
        context: 'Document AI packout recognition failed',
        defaultStatus: 502,
        fallbackMessage: 'Document AI could not recognize this packout',
      });
    }
  }
);

router.post('/events/:id/packout', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    const manager = isBarManager(req.auth);
    if (!manager && !isBarWorker(req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (!manager && event.items.length > 0) {
      return res.status(409).json({ message: 'A packout already exists. Ask a bar admin to replace it.' });
    }
    const sourceItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!sourceItems.length) return res.status(400).json({ message: 'Packout items are required' });
    if (sourceItems.length > MAX_PACKOUT_ITEMS) {
      return res.status(413).json({ message: `Packout is limited to ${MAX_PACKOUT_ITEMS} items` });
    }
    event.items = await normalizePackoutItems(sourceItems, {
      allowFinancials: manager,
      guestCount: event.guestCount,
    });
    if (!event.items.length) {
      return res.status(422).json({ message: 'No alcohol, cocktails or mocktails were selected for this event' });
    }
    const packoutType = ['general', 'bar_only', 'alcohol_only'].includes(String(req.body?.packoutType))
      ? String(req.body.packoutType)
      : 'unknown';
    event.packout = {
      fileName: cleanString(req.body?.fileName, 240),
      contentType: cleanString(req.body?.contentType, 120),
      packoutType,
      importedAt: new Date(),
      importedBy: String(req.auth?.username || req.auth?.email || ''),
    };
    if (event.status === 'draft') event.status = 'ready';
    event.revision += 1;
    addAudit(event, req.auth, 'packout_imported', {
      fileName: event.packout.fileName,
      itemCount: event.items.length,
      packoutType,
    });
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: manager }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar packout import failed',
      fallbackMessage: 'Failed to import bar packout',
    });
  }
});

router.patch('/events/:id/items/:itemId', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    const item = event.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Packout item not found' });
    const requestedCatalogValue = req.body?.beverageItemId;
    const catalogId = isObjectId(requestedCatalogValue) ? String(requestedCatalogValue) : null;
    let catalogItem = null;
    if (catalogId) {
      catalogItem = await BeverageItem.findById(catalogId).select('+purchaseCost +caseCost');
      if (!catalogItem) return res.status(400).json({ message: 'Beverage catalog item not found' });
      item.beverageItemId = catalogItem._id;
    } else if (requestedCatalogValue === null || requestedCatalogValue === '') {
      item.beverageItemId = null;
    } else if (requestedCatalogValue !== undefined) {
      return res.status(400).json({ message: 'Invalid beverage catalog item id' });
    }
    if (req.body?.name !== undefined) item.name = cleanString(req.body.name, 240);
    if (!item.name) return res.status(400).json({ message: 'Item name is required' });
    if (req.body?.section !== undefined) item.section = cleanString(req.body.section, 160);
    if (req.body?.scope !== undefined && BAR_ITEM_SCOPES.includes(String(req.body.scope))) {
      item.scope = String(req.body.scope);
    }
    if (req.body?.included !== undefined) item.included = cleanBoolean(req.body.included, item.included);
    if (req.body?.sentQty !== undefined) {
      item.sentQty = cleanNumber(req.body.sentQty, { fallback: 0 });
      if (req.body?.sentQtyText === undefined) item.sentQtyText = String(item.sentQty);
    }
    if (req.body?.sentQtyText !== undefined) item.sentQtyText = cleanString(req.body.sentQtyText, 80);
    if (req.body?.deliveredQty !== undefined) item.deliveredQty = cleanNumber(req.body.deliveredQty, { fallback: null });
    if (req.body?.unitCostSnapshot !== undefined || catalogItem) {
      item.unitCostSnapshot = cleanNumber(req.body?.unitCostSnapshot, {
        fallback: catalogItem ? resolveCatalogUnitCost(catalogItem) : item.unitCostSnapshot,
      });
    }
    if (req.body?.bottleSizeMl !== undefined || catalogItem) {
      item.bottleSizeMl = cleanNumber(req.body?.bottleSizeMl, {
        fallback: cleanNumber(catalogItem?.bottleSizeMl, { fallback: item.bottleSizeMl }),
      });
    }
    if (req.body?.notes !== undefined) item.notes = cleanString(req.body.notes, 1000);
    item.updatedBy = String(req.auth?.username || req.auth?.email || '');
    item.updatedAt = new Date();
    event.revision += 1;
    addAudit(event, req.auth, 'packout_item_updated', { itemId: String(item._id) });
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: true }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar packout item update failed',
      fallbackMessage: 'Failed to update packout item',
    });
  }
});

router.patch('/events/:id/items/:itemId/return', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canOperateEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (event.status === 'closed') {
      return res.status(409).json({ message: 'This event bar report is closed' });
    }
    const item = event.items.id(req.params.itemId);
    if (!item || item.included === false) {
      return res.status(404).json({ message: 'Packout item not found' });
    }
    if (!requiresBarReturn(item)) {
      return res.status(409).json({ message: 'Cocktails and mocktails are fixed event expenses and do not require returns' });
    }
    if (!isBarManager(req.auth) && item.returnConfirmed === true) {
      return res.status(409).json({ message: 'Returns for this item were already entered' });
    }
    const returnFields = ['returnedFullQty', 'returnedOpenQty', 'lostDamagedQty'];
    const nextReturnValues = {};
    for (const field of returnFields) {
      if (req.body?.[field] === undefined) {
        nextReturnValues[field] = Number(item[field] || 0);
        continue;
      }
      const numeric = Number(req.body[field]);
      if (!Number.isFinite(numeric) || numeric < 0) {
        return res.status(400).json({ message: `${field} must be zero or greater` });
      }
      if (field === 'returnedFullQty' && !Number.isInteger(numeric)) {
        return res.status(400).json({ message: 'Full returned quantity must be a whole number' });
      }
      nextReturnValues[field] = numeric;
    }
    const returnValidation = validateBarReturnQuantities({
      ...item.toObject(),
      ...nextReturnValues,
    });
    if (!returnValidation.valid) {
      return res.status(400).json({
        message: returnValidation.message,
        accounting: returnValidation.accounting,
      });
    }
    Object.assign(item, nextReturnValues);
    if (req.body?.captainNotes !== undefined) {
      item.captainNotes = cleanString(req.body.captainNotes, 1000);
    }
    item.returnConfirmed = req.body?.returnConfirmed === undefined
      ? true
      : cleanBoolean(req.body.returnConfirmed, true);
    item.updatedBy = String(req.auth?.username || req.auth?.email || '');
    item.updatedAt = new Date();
    if (event.status === 'ready') event.status = 'in_progress';
    event.revision += 1;
    addAudit(event, req.auth, 'return_updated', { itemId: String(item._id) });
    await event.save();
    return res.json(serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar return update failed',
      fallbackMessage: 'Failed to update returned quantity',
    });
  }
});

router.post('/events/:id/submit', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canOperateEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (event.status === 'closed') return res.status(409).json({ message: 'This event bar report is closed' });
    const unconfirmed = event.items.filter((item) => (
      item.included !== false && requiresBarReturn(item) && item.returnConfirmed !== true
    ));
    if (unconfirmed.length) {
      return res.status(400).json({
        message: `Confirm returns for all items (${unconfirmed.length} remaining)`,
        unconfirmedItemIds: unconfirmed.map((item) => item._id),
      });
    }
    event.status = 'submitted';
    event.submittedAt = new Date();
    event.submittedBy = String(req.auth?.username || req.auth?.email || '');
    event.revision += 1;
    addAudit(event, req.auth, 'returns_submitted');
    await event.save();
    return res.json(serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar return submission failed',
      fallbackMessage: 'Failed to submit bar returns',
    });
  }
});

router.post('/events/:id/review', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    event.status = cleanBoolean(req.body?.close, false) ? 'closed' : 'reviewed';
    event.reviewedAt = new Date();
    event.reviewedBy = String(req.auth?.username || req.auth?.email || '');
    event.revision += 1;
    addAudit(event, req.auth, event.status === 'closed' ? 'event_closed' : 'returns_reviewed');
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: true }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar report review failed',
      fallbackMessage: 'Failed to review the event bar report',
    });
  }
});

router.post('/events/:id/reopen', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    event.status = 'in_progress';
    event.reviewedAt = null;
    event.reviewedBy = '';
    event.revision += 1;
    addAudit(event, req.auth, 'event_reopened');
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: true }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar report reopen failed',
      fallbackMessage: 'Failed to reopen the event bar report',
    });
  }
});

export default router;
