import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import BarEvent, { BAR_EVENT_STATUSES, BAR_ITEM_SCOPES, BAR_PRICE_UNITS } from '../models/BarEvent.js';
import BarPackage from '../models/BarPackage.js';
import BarTask from '../models/BarTask.js';
import BeverageItem from '../models/BeverageItem.js';
import CocktailRecipe from '../models/CocktailRecipe.js';
import Event from '../models/Event.js';
import Staff from '../models/Staff.js';
import User from '../models/Users.js';
import DocumentImportRun from '../models/DocumentImportRun.js';
import { canSeeBarFinancials, isAdminAuth, normalizeRole } from '../middleware/auth.js';
import {
  calculateBarEventAccounting,
  calculateBarItemAccounting,
  validateBarReturnQuantities,
} from '../utils/barEventAccounting.js';
import { normalizeBarEventDate } from '../utils/barEventDates.js';
import {
  barEventNumbersMatch,
  inferBarChargeDateRange,
  normalizeBarEventNumber,
  prepareBarChargeImport,
} from '../utils/barChargeImport.js';
import { sendApiError } from '../utils/apiErrors.js';
import { clearApiCacheGroups } from '../utils/apiCache.js';
import { cocktailServingsForGuests, resolveCocktailRecipeKey } from '../utils/cocktailRecipes.js';
import { barItemIdentityKey, mergePackoutDocumentItems, preservePackoutOperationalState, schedulePreparedItemsForEvent } from '../utils/barManualItems.js';
import { recognizeDocuments } from '../utils/googleDocumentAi.js';
import { snapshotBarDocumentImport } from '../utils/documentImportAudit.js';
import { summarizeBarEventReadiness } from '../utils/barEventReadiness.js';
import { matchNowstaCaptainUserIds } from '../utils/nowstaCaptainAssignments.js';
import {
  keepBarAccountingItems,
  matchRecognizedItemsToCatalog,
  normalizeOcrCatalogName,
  parseRecognizedPackout,
} from '../utils/barPackoutRecognition.js';
import {
  getPreparedBeverageRate,
  getPreparedBeverageType,
  isBarAccountingItem,
  requiresBarReturn,
} from '../utils/barPackoutScope.js';

const router = Router();
const BAR_MANAGER_ROLES = new Set(['bar admin']);
const BAR_WORKER_ROLES = new Set(['bar captain', 'bartender']);
const BAR_VIEWER_ROLES = new Set(['user', 'manager', 'sales rep']);
const MAX_PACKOUT_ITEMS = 500;
const MAX_CHARGE_IMPORT_ROWS = 2_000;
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
const isBarCaptain = (auth) => normalizeRole(auth?.role) === 'bar captain';

const eventAssignedToAuth = (event, auth) => {
  const userId = String(auth?.userId || '');
  if (!userId) return false;
  return (Array.isArray(event?.assignedUserIds) ? event.assignedUserIds : [])
    .some((assignedId) => String(assignedId) === userId);
};

const canViewEvent = (event, auth) => (
  isBarManager(auth)
  || BAR_VIEWER_ROLES.has(normalizeRole(auth?.role))
  || (isBarCaptain(auth) ? eventAssignedToAuth(event, auth) : isBarWorker(auth))
);

const canOperateEvent = (event, auth) => (
  isBarManager(auth)
  || (isBarCaptain(auth) ? eventAssignedToAuth(event, auth) : isBarWorker(auth))
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
  const captainSyncAudit = [...(Array.isArray(event.audit) ? event.audit : [])].reverse().find((entry) => (
    ['guest_received_saved', 'guest_returns_submitted'].includes(String(entry?.action || ''))
  ));
  event.captainSync = captainSyncAudit ? {
    action: captainSyncAudit.action,
    reporterName: captainSyncAudit.username || event.guestIntake?.reporterName || '',
    syncedAt: captainSyncAudit.at || null,
    clientSavedAt: captainSyncAudit.details?.clientSavedAt || '',
    queuedAt: captainSyncAudit.details?.queuedAt || '',
    deviceId: captainSyncAudit.details?.clientDeviceId || '',
  } : null;
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
    delete event.clientChargeDetails;
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

const serializeBarTask = (source) => {
  const task = typeof source?.toObject === 'function' ? source.toObject() : { ...(source || {}) };
  return {
    ...task,
    eventId: task.eventId ? String(task.eventId) : '',
    eventItemId: task.eventItemId ? String(task.eventItemId) : '',
    assigneeStaffId: task.assigneeStaffId ? String(task.assigneeStaffId) : '',
    completed: Boolean(task.completedAt),
  };
};

const resolveBarTaskAssignee = async (source = {}) => {
  const requestedStaffId = cleanString(source?.assigneeStaffId, 80);
  const requestedName = cleanString(source?.assigneeName, 160);
  if (!requestedStaffId) return { assigneeStaffId: null, assigneeName: requestedName };
  if (!isObjectId(requestedStaffId)) throw Object.assign(new Error('Invalid responsible staff id'), { status: 400 });
  const staff = await Staff.findById(requestedStaffId).select('_id firstName lastName').lean();
  if (!staff) throw Object.assign(new Error('Responsible staff member was not found'), { status: 400 });
  return {
    assigneeStaffId: staff._id,
    assigneeName: requestedName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim(),
  };
};

const resolveBarTaskPriority = (value, fallback = 'normal') => {
  const priority = cleanString(value, 20).toLowerCase();
  if (!priority) return fallback;
  if (!['normal', 'important', 'urgent'].includes(priority)) {
    throw Object.assign(new Error('Task priority must be normal, important or urgent'), { status: 400 });
  }
  return priority;
};

const requireBarManager = (req, res, next) => {
  if (!isBarManager(req.auth)) return res.status(403).json({ message: 'Bar admin access required' });
  return next();
};

const requireBarFinancials = (req, res, next) => {
  if (!canSeeBarFinancials(req.auth)) {
    return res.status(403).json({ message: 'Bar financial access required' });
  }
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

const eventSalesRep = (event) => cleanString(
  event?.managerName
  || event?.salesRepName
  || event?.sales_rep_name
  || event?.manager_name
  || event?.salesRep
  || event?.sales_rep
  || event?.sales
  || event?.manager
  || event?.managerId,
  180
);

const syncDashboardEventsToBar = async ({ eventId = null } = {}) => {
  const query = {
    status: { $not: /^deleted$/i },
    ...(eventId && isObjectId(eventId) ? { _id: eventId } : {}),
  };
  const dashboardEvents = await Event.find(query).lean();
  if (!dashboardEvents.length) return [];
  const linkedIds = dashboardEvents.map((event) => event._id);
  const existingReports = await BarEvent.find({ linkedEventId: { $in: linkedIds } })
    .select('linkedEventId eventNumber name eventDate client venue salesRep guestCount guestCountSource assignedUserIds')
    .lean();
  const existingByEventId = new Map(
    existingReports.map((report) => [String(report.linkedEventId), report])
  );
  const captainUsers = await User.find({ role: 'bar captain', isActive: { $ne: false } })
    .select('_id username email nowstaName')
    .lean();
  const operations = dashboardEvents.flatMap((event) => {
    const current = existingByEventId.get(String(event._id));
    const next = {
      eventNumber: cleanString(event.externalId, 120) || cleanString(current?.eventNumber, 120),
      name: cleanString(event.title, 240) || 'Untitled event',
      eventDate: normalizeBarEventDate(event.date) || cleanString(event.date, 80),
      client: cleanString(event.client, 180),
      venue: eventVenue(event),
      salesRep: eventSalesRep(event),
      assignedUserIds: matchNowstaCaptainUserIds({ event, users: captainUsers }),
    };
    const preserveBarGuestCount = ['manual', 'packout'].includes(String(current?.guestCountSource || ''));
    if (!preserveBarGuestCount) {
      next.guestCount = eventGuestCount(event);
      next.guestCountSource = 'dashboard';
    }
    const unchanged = current
      && String(current.name || '') === next.name
      && String(current.eventNumber || '') === next.eventNumber
      && String(current.eventDate || '') === next.eventDate
      && String(current.client || '') === next.client
      && String(current.venue || '') === next.venue
      && String(current.salesRep || '') === next.salesRep
      && (Array.isArray(current.assignedUserIds) ? current.assignedUserIds.map(String).sort().join(',') : '')
        === next.assignedUserIds.slice().sort().join(',')
      && (preserveBarGuestCount || (
        (current.guestCount ?? null) === next.guestCount
        && String(current.guestCountSource || 'dashboard') === next.guestCountSource
      ));
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
  return linkedIds;
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

router.get('/packages', requireBarManager, requireBarFinancials, async (_req, res) => {
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

router.post('/packages', requireBarManager, requireBarFinancials, async (req, res) => {
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

router.patch('/packages/:packageId', requireBarManager, requireBarFinancials, async (req, res) => {
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

router.delete('/packages/:packageId', requireBarManager, requireBarFinancials, async (req, res) => {
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
    .map((item) => normalizeOcrCatalogName(item?.name))
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
    const nameKey = normalizeOcrCatalogName(item.name);
    if (nameKey && names.has(nameKey) && !byName.has(nameKey)) byName.set(nameKey, item);
    (Array.isArray(item.aliases) ? item.aliases : []).forEach((alias) => {
      const aliasKey = normalizeOcrCatalogName(alias);
      if (aliasKey && names.has(aliasKey) && !byName.has(aliasKey)) byName.set(aliasKey, item);
    });
  });
  return { byId, byName };
};

export const normalizePackoutItems = async (items, { allowFinancials = false, guestCount = null } = {}) => {
  const source = keepBarAccountingItems(Array.isArray(items) ? items.slice(0, MAX_PACKOUT_ITEMS) : []);
  const [catalog, cocktailRecipes] = await Promise.all([
    resolveCatalog(source),
    CocktailRecipe.find({ active: { $ne: false } }).select('key name aliases').lean(),
  ]);
  return source
    .map((item) => {
      const requestedCatalogId = isObjectId(item?.beverageItemId) ? String(item.beverageItemId) : null;
      const catalogItem = (requestedCatalogId ? catalog.byId.get(requestedCatalogId) : null)
        || catalog.byName.get(normalizeOcrCatalogName(item?.name))
        || null;
      const beverageItemId = catalogItem?._id || requestedCatalogId || null;
      const catalogUnitCost = resolveCatalogUnitCost(catalogItem);
      const scope = BAR_ITEM_SCOPES.includes(cleanString(item?.scope, 30))
        ? cleanString(item.scope, 30)
        : 'review';
      const preparedBeverageType = getPreparedBeverageType(item);
      const preparedRate = getPreparedBeverageRate(item);
      const cocktailServingsAuto = preparedBeverageType
        ? cleanBoolean(item?.cocktailServingsAuto, true)
        : false;
      const automaticCocktailServings = cocktailServingsAuto
        ? cocktailServingsForGuests(guestCount)
        : null;
      const sentQty = cleanNumber(automaticCocktailServings ?? item?.sentQty ?? item?.quantity, {
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
        sentQtyPending: cleanBoolean(item?.sentQtyPending, false),
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
        cocktailRecipeKey: cleanString(item?.cocktailRecipeKey, 80)
          || (preparedBeverageType ? resolveCocktailRecipeKey(item?.name, cocktailRecipes) : ''),
        cocktailServingsAuto,
        clientProvidedIngredients: (Array.isArray(item?.clientProvidedIngredients) ? item.clientProvidedIngredients : [])
          .slice(0, 30)
          .map((value) => cleanString(value, 120))
          .filter(Boolean),
        batchInstructions: cleanString(item?.batchInstructions, 2000),
        entrySource: cleanString(item?.entrySource, 20) === 'manual' ? 'manual' : 'packout',
      };
    })
    .filter((item) => item.name);
};

router.get('/tasks', requireBarManager, async (_req, res) => {
  try {
    const tasks = await BarTask.find({}).sort({ scheduledDate: 1, createdAt: 1 }).limit(5000);
    return res.json(tasks.map(serializeBarTask));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar task list failed',
      fallbackMessage: 'Failed to list bar tasks',
    });
  }
});

router.post('/tasks', requireBarManager, async (req, res) => {
  try {
    const title = cleanString(req.body?.title, 500);
    const scheduledDate = cleanString(req.body?.scheduledDate, 10);
    if (title.length < 2) return res.status(400).json({ message: 'Task description is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      return res.status(400).json({ message: 'Task date must use YYYY-MM-DD format' });
    }

    const requestedEventId = cleanString(req.body?.eventId, 80);
    const requestedItemId = cleanString(req.body?.eventItemId, 80);
    let event = null;
    let eventItem = null;
    if (requestedEventId) {
      if (!isObjectId(requestedEventId)) return res.status(400).json({ message: 'Invalid event id' });
      event = await BarEvent.findById(requestedEventId);
      if (!event) return res.status(400).json({ message: 'Event not found' });
      if (requestedItemId) {
        if (!isObjectId(requestedItemId)) return res.status(400).json({ message: 'Invalid cocktail id' });
        eventItem = event.items.id(requestedItemId);
        if (!eventItem) return res.status(400).json({ message: 'Cocktail was not found in this event' });
      }
    } else if (requestedItemId) {
      return res.status(400).json({ message: 'Choose an event before choosing its cocktail' });
    }

    const username = String(req.auth?.username || req.auth?.email || '');
    const assignee = await resolveBarTaskAssignee(req.body);
    const task = await BarTask.create({
      title,
      scheduledDate,
      eventId: event?._id || null,
      eventItemId: eventItem?._id || null,
      cocktailRecipeKey: cleanString(req.body?.cocktailRecipeKey, 80) || cleanString(eventItem?.cocktailRecipeKey, 80),
      cocktailName: cleanString(req.body?.cocktailName, 240) || cleanString(eventItem?.name, 240),
      ...assignee,
      priority: resolveBarTaskPriority(req.body?.priority),
      createdBy: username,
      updatedBy: username,
    });
    return res.status(201).json(serializeBarTask(task));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar task creation failed',
      fallbackMessage: 'Failed to create bar task',
    });
  }
});

router.patch('/tasks/:taskId', requireBarManager, async (req, res) => {
  try {
    if (!isObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task id' });
    const task = await BarTask.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (req.body?.title !== undefined) {
      const title = cleanString(req.body.title, 500);
      if (title.length < 2) return res.status(400).json({ message: 'Task description is required' });
      task.title = title;
    }
    if (req.body?.scheduledDate !== undefined) {
      const scheduledDate = cleanString(req.body.scheduledDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return res.status(400).json({ message: 'Task date must use YYYY-MM-DD format' });
      }
      task.scheduledDate = scheduledDate;
    }
    if (req.body?.eventId !== undefined || req.body?.eventItemId !== undefined) {
      const requestedEventId = cleanString(req.body?.eventId, 80);
      const requestedItemId = cleanString(req.body?.eventItemId, 80);
      let event = null;
      let eventItem = null;
      if (requestedEventId) {
        if (!isObjectId(requestedEventId)) return res.status(400).json({ message: 'Invalid event id' });
        event = await BarEvent.findById(requestedEventId);
        if (!event) return res.status(400).json({ message: 'Event not found' });
        if (requestedItemId) {
          if (!isObjectId(requestedItemId)) return res.status(400).json({ message: 'Invalid cocktail id' });
          eventItem = event.items.id(requestedItemId);
          if (!eventItem) return res.status(400).json({ message: 'Cocktail was not found in this event' });
        }
      } else if (requestedItemId) {
        return res.status(400).json({ message: 'Choose an event before choosing its cocktail' });
      }
      task.eventId = event?._id || null;
      task.eventItemId = eventItem?._id || null;
    }
    if (req.body?.cocktailRecipeKey !== undefined) {
      task.cocktailRecipeKey = cleanString(req.body.cocktailRecipeKey, 80);
    }
    if (req.body?.cocktailName !== undefined) {
      task.cocktailName = cleanString(req.body.cocktailName, 240);
    }
    if (req.body?.assigneeStaffId !== undefined || req.body?.assigneeName !== undefined) {
      const assignee = await resolveBarTaskAssignee(req.body);
      task.assigneeStaffId = assignee.assigneeStaffId;
      task.assigneeName = assignee.assigneeName;
    }
    if (req.body?.priority !== undefined) {
      const priority = cleanString(req.body.priority, 20).toLowerCase();
      if (!['normal', 'important', 'urgent'].includes(priority)) {
        return res.status(400).json({ message: 'Task priority must be normal, important or urgent' });
      }
      task.priority = priority;
    }
    if (req.body?.completed !== undefined) {
      const completed = cleanBoolean(req.body.completed, Boolean(task.completedAt));
      const username = String(req.auth?.username || req.auth?.email || '');
      task.completedAt = completed ? (task.completedAt || new Date()) : null;
      task.completedBy = completed ? (task.completedBy || username) : '';
    }
    task.updatedBy = String(req.auth?.username || req.auth?.email || '');
    await task.save();
    return res.json(serializeBarTask(task));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar task update failed',
      fallbackMessage: 'Failed to update bar task',
    });
  }
});

router.delete('/tasks/:taskId', requireBarManager, async (req, res) => {
  try {
    if (!isObjectId(req.params.taskId)) return res.status(400).json({ message: 'Invalid task id' });
    const removed = await BarTask.findByIdAndDelete(req.params.taskId);
    if (!removed) return res.status(404).json({ message: 'Task not found' });
    return res.status(204).end();
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar task deletion failed',
      fallbackMessage: 'Failed to delete bar task',
    });
  }
});

router.get('/events', async (req, res) => {
  try {
    if (!isBarManager(req.auth) && !isBarWorker(req.auth) && !BAR_VIEWER_ROLES.has(normalizeRole(req.auth?.role))) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    const activeDashboardEventIds = await syncDashboardEventsToBar();
    const query = {
      $or: [
        { linkedEventId: { $in: activeDashboardEventIds } },
        { linkedEventId: null },
      ],
    };
    if (req.query.status && BAR_EVENT_STATUSES.includes(String(req.query.status))) {
      query.status = String(req.query.status);
    }
    if (isBarCaptain(req.auth)) {
      query.assignedUserIds = req.auth.userId;
    }
    const events = await BarEvent.find(query).sort({ eventDate: -1, createdAt: -1 });
    return res.json(events.map((event) => serializeBarEvent(event, {
      includeFinancials: canSeeBarFinancials(req.auth),
    })));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar reports list failed',
      fallbackMessage: 'Failed to list event bar reports',
    });
  }
});

router.get('/events-readiness', async (req, res) => {
  try {
    if (!isBarManager(req.auth) && !isBarWorker(req.auth) && !BAR_VIEWER_ROLES.has(normalizeRole(req.auth?.role))) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    const requestedFrom = cleanString(req.query.from, 10);
    const linkedEventId = cleanString(req.query.linkedEventId, 80);
    if (linkedEventId && !isObjectId(linkedEventId)) {
      return res.status(400).json({ message: 'Invalid linked event id' });
    }
    const from = /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom)
      ? requestedFrom
      : new Date().toISOString().slice(0, 10);
    const query = {
      linkedEventId: { $ne: null },
    };
    if (linkedEventId) {
      query.linkedEventId = linkedEventId;
    } else {
      query.eventDate = { $gte: from };
      query.status = { $ne: 'closed' };
    }
    const events = await BarEvent.find(query)
      .select('_id linkedEventId items')
      .lean();
    return res.json(events.map(summarizeBarEventReadiness));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar event readiness failed',
      fallbackMessage: 'Failed to load bar event readiness',
    });
  }
});

router.post('/events/charges/import', requireBarManager, async (req, res) => {
  try {
    if (!canSeeBarFinancials(req.auth)) {
      return res.status(403).json({ message: 'Bar financial access required' });
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: 'No Caterease charge rows were provided' });
    if (rows.length > MAX_CHARGE_IMPORT_ROWS) {
      return res.status(413).json({ message: `Charge import is limited to ${MAX_CHARGE_IMPORT_ROWS} rows` });
    }
    const requestedFrom = cleanString(req.body?.from, 10);
    const requestedTo = cleanString(req.body?.to, 10);
    const inferredRange = inferBarChargeDateRange(rows);
    const from = requestedFrom || inferredRange?.from || '';
    const to = requestedTo || inferredRange?.to || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ message: 'No valid Event Date range was found in the Caterease report' });
    }

    const activeDashboardEventIds = await syncDashboardEventsToBar();
    const events = await BarEvent.find({
      eventDate: { $gte: from, $lte: to },
      $or: [
        { linkedEventId: { $in: activeDashboardEventIds } },
        { linkedEventId: null },
      ],
    })
      .select('_id linkedEventId eventNumber eventDate name client clientCharge')
      .lean();
    const preview = prepareBarChargeImport({ rows, events, from, to });
    const apply = cleanBoolean(req.body?.apply, false);
    if (!apply || !preview.importableRows.length) {
      return res.json({ ...preview, importableRows: undefined, range: { from, to }, applied: 0 });
    }

    const sourceFileName = cleanString(req.body?.fileName, 240);
    const importedAt = new Date();
    const importedBy = cleanString(req.auth?.username || req.auth?.email, 180);
    const operations = preview.importableRows.map((row) => ({
      updateOne: {
        filter: { _id: row.eventId, eventDate: row.eventDate },
        update: {
          $set: {
            eventNumber: row.sourceEventNumber,
            clientCharge: row.clientCharge,
            currency: 'USD',
            clientChargeDetails: {
              beverageSubtotal: row.beverageSubtotal,
              liquorSubtotal: row.liquorSubtotal,
              source: 'caterease',
              sourceFileName,
              importedAt,
              importedBy,
            },
          },
          $inc: { revision: 1 },
          $push: {
            audit: {
              $each: [{
                action: 'caterease_charge_imported',
                userId: String(req.auth?.userId || ''),
                username: importedBy,
                at: importedAt,
                details: {
                  beverageSubtotal: row.beverageSubtotal,
                  liquorSubtotal: row.liquorSubtotal,
                  clientCharge: row.clientCharge,
                  sourceFileName,
                },
              }],
              $slice: -MAX_AUDIT_ENTRIES,
            },
          },
        },
      },
    }));
    const result = await BarEvent.bulkWrite(operations, { ordered: false });
    const linkedEventOperations = preview.importableRows
      .filter((row) => isObjectId(row.linkedEventId))
      .map((row) => ({
        updateOne: {
          filter: {
            _id: row.linkedEventId,
            $or: [
              { externalId: row.sourceEventNumber },
              { externalId: '' },
              { externalId: null },
              { externalId: { $exists: false } },
            ],
          },
          update: { $set: { externalId: row.sourceEventNumber } },
        },
      }));
    if (linkedEventOperations.length) {
      await Event.bulkWrite(linkedEventOperations, { ordered: false });
      clearApiCacheGroups('events');
    }
    return res.json({
      ...preview,
      importableRows: undefined,
      range: { from, to },
      applied: result.modifiedCount || 0,
      summary: { ...preview.summary, applied: result.modifiedCount || 0 },
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Caterease bar charge import failed',
      fallbackMessage: 'Failed to import Caterease client charges',
    });
  }
});

router.get('/events/:id/link-candidates', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (event.guestIntake?.pendingReview !== true) {
      return res.status(409).json({ message: 'This report is not pending office review' });
    }
    const dashboardEvents = await Event.find({ status: { $not: /^deleted$/i } })
      .select('title date client meta')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    const candidates = dashboardEvents
      .filter((candidate) => normalizeBarEventDate(candidate.date) === event.eventDate)
      .slice(0, 50)
      .map((candidate) => ({
        id: String(candidate._id),
        title: cleanString(candidate.title, 240),
        date: normalizeBarEventDate(candidate.date) || cleanString(candidate.date, 80),
        client: cleanString(candidate.client, 180),
        venue: eventVenue(candidate),
      }));
    return res.json({ candidates });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Pending bar report candidates failed',
      fallbackMessage: 'Failed to load matching dashboard events',
    });
  }
});

router.post('/events/:id/resolve-pending', requireBarManager, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (event.guestIntake?.pendingReview !== true) {
      return res.status(409).json({ message: 'This report is not pending office review' });
    }
    const action = cleanString(req.body?.action, 40);
    if (!['link', 'create', 'bar_only'].includes(action)) {
      return res.status(400).json({ message: 'Choose how to resolve this pending report' });
    }

    let dashboardEvent = null;
    if (action === 'link') {
      if (!isObjectId(req.body?.eventId)) {
        return res.status(400).json({ message: 'Choose a valid dashboard event' });
      }
      dashboardEvent = await Event.findById(req.body.eventId);
      if (!dashboardEvent || /^deleted$/i.test(String(dashboardEvent.status || ''))) {
        return res.status(404).json({ message: 'Dashboard event not found' });
      }
      if (normalizeBarEventDate(dashboardEvent.date) !== event.eventDate) {
        return res.status(409).json({ message: 'The dashboard event date does not match this report' });
      }
    }

    if (action === 'create') {
      const existingDashboardEvents = await Event.find({ status: { $not: /^deleted$/i } })
        .select('title date')
        .limit(500)
        .lean();
      const duplicate = existingDashboardEvents.find((candidate) => (
        normalizeBarEventDate(candidate.date) === event.eventDate
        && normalizeCatalogName(candidate.title) === normalizeCatalogName(event.name)
      ));
      if (duplicate) {
        return res.status(409).json({
          message: 'A dashboard event with this name and date already exists. Link it instead.',
          eventId: String(duplicate._id),
        });
      }
      dashboardEvent = await Event.create({
        title: event.name,
        date: event.eventDate,
        client: event.client || '',
        status: 'draft',
        meta: event.venue ? { venue: event.venue } : {},
      });
      clearApiCacheGroups('events');
    }

    if (action === 'bar_only') {
      event.guestIntake.pendingReview = false;
      event.revision += 1;
      addAudit(event, req.auth, 'guest_report_approved_bar_only');
      await event.save();
      return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
    }

    const linkedReport = await BarEvent.findOne({
      linkedEventId: dashboardEvent._id,
      _id: { $ne: event._id },
    });
    if (linkedReport) {
      const linkedHasWork = linkedReport.items.length > 0
        || Boolean(linkedReport.packout?.importedAt)
        || Boolean(linkedReport.submittedAt);
      if (linkedHasWork) {
        return res.status(409).json({
          message: 'The selected event already has a populated bar report. Review the two reports manually.',
          barEventId: String(linkedReport._id),
        });
      }
      linkedReport.items = event.items.map((item) => item.toObject());
      linkedReport.packout = event.packout?.toObject ? event.packout.toObject() : event.packout;
      linkedReport.status = event.status;
      linkedReport.eventNumber = event.eventNumber || linkedReport.eventNumber;
      linkedReport.submittedAt = event.submittedAt;
      linkedReport.submittedBy = event.submittedBy;
      linkedReport.guestIntake = {
        ...(event.guestIntake?.toObject ? event.guestIntake.toObject() : event.guestIntake),
        pendingReview: false,
      };
      linkedReport.audit = [...linkedReport.audit, ...event.audit].slice(-MAX_AUDIT_ENTRIES);
      linkedReport.revision += 1;
      addAudit(linkedReport, req.auth, 'guest_report_linked', {
        sourceBarEventId: String(event._id),
        linkedEventId: String(dashboardEvent._id),
      });
      await linkedReport.save();
      await BarEvent.deleteOne({ _id: event._id });
      return res.json(serializeBarEvent(linkedReport, { includeFinancials: canSeeBarFinancials(req.auth) }));
    }

    event.linkedEventId = dashboardEvent._id;
    event.guestIntake.pendingReview = false;
    event.revision += 1;
    addAudit(event, req.auth, action === 'create' ? 'guest_report_event_created' : 'guest_report_linked', {
      linkedEventId: String(dashboardEvent._id),
    });
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Pending bar report resolution failed',
      fallbackMessage: 'Failed to resolve this pending report',
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
      return res.status(403).json({
        message: isBarCaptain(req.auth)
          ? 'This event is not assigned to your account in Nowsta'
          : 'Bar access required',
      });
    }
    return res.json(serializeBarEvent(event, {
      includeFinancials: canSeeBarFinancials(req.auth),
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
      return res.status(403).json({
        message: isBarCaptain(req.auth)
          ? 'This event is not assigned to your account in Nowsta'
          : 'Bar access required',
      });
    }
    return res.json(serializeBarEvent(event, {
      includeFinancials: canSeeBarFinancials(req.auth),
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
    const financialFields = ['packageSnapshot', 'clientCharge', 'currency'];
    if (financialFields.some((field) => req.body?.[field] !== undefined) && !canSeeBarFinancials(req.auth)) {
      return res.status(403).json({ message: 'Bar financial access required' });
    }
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
      event.guestCountSource = 'manual';
      event.items.forEach((item) => {
        if (getPreparedBeverageType(item) && item.cocktailServingsAuto !== false) {
          item.sentQty = cocktailServingsForGuests(event.guestCount);
          item.sentQtyText = String(item.sentQty);
        }
      });
    }
    if (req.body?.packageSnapshot !== undefined) {
      event.packageSnapshot = normalizePackage(req.body.packageSnapshot, event.packageSnapshot);
    }
    if (req.body?.clientCharge !== undefined) {
      const clientCharge = Number(req.body.clientCharge);
      if (!Number.isFinite(clientCharge) || clientCharge < 0) {
        return res.status(400).json({ message: 'Final client charge must be zero or greater' });
      }
      event.clientCharge = clientCharge;
      event.clientChargeDetails = {
        beverageSubtotal: null,
        liquorSubtotal: null,
        source: 'manual',
        sourceFileName: '',
        importedAt: null,
        importedBy: '',
      };
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
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
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
    if (!manager && event.items.some((item) => item.entrySource !== 'manual')) {
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
      if (!manager && event.items.some((item) => item.entrySource !== 'manual')) {
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
    const documentImportBatchId = cleanString(req.body?.documentImportBatchId, 120);
    const beforeBarEvent = documentImportBatchId ? snapshotBarDocumentImport(event) : null;
    const manager = isBarManager(req.auth);
    if (!manager && !isBarWorker(req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (!manager && event.items.some((item) => item.entrySource !== 'manual')) {
      return res.status(409).json({ message: 'A packout already exists. Ask a bar admin to replace it.' });
    }
    const sourceItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!sourceItems.length) return res.status(400).json({ message: 'Packout items are required' });
    if (sourceItems.length > MAX_PACKOUT_ITEMS) {
      return res.status(413).json({ message: `Packout is limited to ${MAX_PACKOUT_ITEMS} items` });
    }
    if (req.body?.guestCount !== undefined && req.body.guestCount !== null) {
      const guestCount = Number(req.body.guestCount);
      if (!Number.isInteger(guestCount) || guestCount < 0) {
        return res.status(400).json({ message: 'Guest count must be a whole number of zero or greater' });
      }
      event.guestCount = guestCount;
      event.guestCountSource = 'packout';
    }
    const importedEventNumber = normalizeBarEventNumber(cleanString(req.body?.eventNumber, 120));
    const storedEventNumber = normalizeBarEventNumber(event.eventNumber);
    if (importedEventNumber && storedEventNumber && !barEventNumbersMatch(importedEventNumber, storedEventNumber)) {
      return res.status(409).json({ message: `PO Event # ${importedEventNumber} does not match this event (${storedEventNumber})` });
    }
    let linkedDashboardEvent = null;
    if (importedEventNumber && isObjectId(event.linkedEventId)) {
      linkedDashboardEvent = await Event.findById(event.linkedEventId).select('externalId');
      const canonicalEventNumber = normalizeBarEventNumber(linkedDashboardEvent?.externalId);
      if (canonicalEventNumber && !barEventNumbersMatch(canonicalEventNumber, importedEventNumber)) {
        return res.status(409).json({ message: `PO Event # ${importedEventNumber} does not match the linked event (${canonicalEventNumber})` });
      }
    }
    if (!storedEventNumber && importedEventNumber) event.eventNumber = importedEventNumber;
    const importedItems = await normalizePackoutItems(sourceItems.map((item) => ({ ...item, entrySource: 'packout' })), {
      allowFinancials: manager,
      guestCount: event.guestCount,
    });
    event.items = preservePackoutOperationalState(
      event.items,
      mergePackoutDocumentItems(event.items, importedItems, req.body?.documentTypes),
    );
    schedulePreparedItemsForEvent(event.items, event.eventDate, {
      at: new Date(),
      by: String(req.auth?.username || req.auth?.email || ''),
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
    if (documentImportBatchId && isObjectId(event.linkedEventId)) {
      await DocumentImportRun.updateMany(
        {
          eventId: event.linkedEventId,
          batchId: documentImportBatchId,
          status: 'applied',
        },
        {
          $set: {
            beforeBarEvent,
            afterBarEvent: snapshotBarDocumentImport(event),
          },
        }
      );
    }
    if (linkedDashboardEvent && !normalizeBarEventNumber(linkedDashboardEvent.externalId) && importedEventNumber) {
      linkedDashboardEvent.externalId = importedEventNumber;
      await linkedDashboardEvent.save();
      clearApiCacheGroups('events');
    }
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar packout import failed',
      fallbackMessage: 'Failed to import bar packout',
    });
  }
});

router.post('/events/:id/items', requireBarOperator, async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canOperateEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (event.status === 'closed') return res.status(409).json({ message: 'This event bar report is closed' });
    const type = cleanString(req.body?.type, 30).toLowerCase();
    const sentQty = cleanNumber(req.body?.sentQty, { fallback: null });
    if (!['liquor', 'cocktail', 'mocktail'].includes(type)) return res.status(400).json({ message: 'Choose liquor, specialty cocktail or mocktail' });
    if (sentQty === null) return res.status(400).json({ message: 'Quantity must be zero or greater' });
    let item;
    if (type === 'liquor') {
      const beverageItemId = cleanString(req.body?.beverageItemId, 80);
      if (beverageItemId && !isObjectId(beverageItemId)) return res.status(400).json({ message: 'Invalid liquor inventory item' });
      const catalogItem = beverageItemId
        ? await BeverageItem.findById(beverageItemId).select('+purchaseCost +caseCost')
        : null;
      if (beverageItemId && (!catalogItem || catalogItem.active === false)) {
        return res.status(400).json({ message: 'Liquor inventory item not found' });
      }
      const manualName = cleanString(req.body?.name, 240);
      if (!catalogItem && manualName.length < 2) {
        return res.status(400).json({ message: 'Choose an inventory item or enter the alcohol name' });
      }
      const requestedCost = canSeeBarFinancials(req.auth)
        ? cleanNumber(req.body?.unitCostSnapshot, { fallback: null })
        : null;
      const unitCostSnapshot = requestedCost ?? (catalogItem ? resolveCatalogUnitCost(catalogItem) : 0);
      item = {
        beverageItemId: catalogItem?._id || null,
        name: catalogItem?.name || manualName,
        section: 'Manual Liquor',
        scope: 'alcohol',
        included: true,
        sentQty,
        sentQtyText: String(sentQty),
        sentQtyPending: false,
        deliveredQty: null,
        returnConfirmed: false,
        unitCostSnapshot,
        bottleSizeMl: cleanNumber(catalogItem?.bottleSizeMl, { fallback: null }),
        cocktailServingsAuto: false,
        entrySource: 'manual',
      };
    } else {
      if (!isBarManager(req.auth)) {
        return res.status(403).json({ message: 'Bar admin access is required to add specialty cocktails' });
      }
      const cocktailRecipeKey = cleanString(req.body?.cocktailRecipeKey, 80);
      const recipe = await CocktailRecipe.findOne({ key: cocktailRecipeKey, active: { $ne: false } });
      if (!recipe) return res.status(400).json({ message: 'Choose a specialty cocktail recipe' });
      const preparedType = type === 'mocktail' || recipe.type === 'mocktail' ? 'mocktail' : 'cocktail';
      item = {
        name: recipe.name,
        section: preparedType === 'mocktail' ? 'Mocktails' : 'Cocktails',
        scope: 'review',
        included: true,
        sentQty,
        sentQtyText: String(sentQty),
        sentQtyPending: false,
        deliveredQty: null,
        returnConfirmed: true,
        unitCostSnapshot: preparedType === 'mocktail' ? 1.5 : 3,
        cocktailRecipeKey: recipe.key,
        cocktailServingsAuto: cleanBoolean(req.body?.cocktailServingsAuto, false),
        batchInstructions: cleanString(req.body?.batchInstructions ?? recipe.instructions, 2000),
        entrySource: 'manual',
      };
    }
    const identity = barItemIdentityKey(item);
    if (event.items.some((existing) => barItemIdentityKey(existing) === identity)) {
      return res.status(409).json({ message: 'This product is already part of the event' });
    }
    item.updatedBy = String(req.auth?.username || req.auth?.email || '');
    item.updatedAt = new Date();
    event.items.push(item);
    if (event.status === 'draft') event.status = 'ready';
    event.revision += 1;
    addAudit(event, req.auth, 'manual_item_added', { type, name: item.name });
    await event.save();
    return res.status(201).json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Manual bar item creation failed',
      fallbackMessage: 'Failed to add product to the event',
    });
  }
});

router.patch('/events/:id/items/:itemId', requireBarManager, async (req, res) => {
  try {
    if (req.body?.unitCostSnapshot !== undefined && !canSeeBarFinancials(req.auth)) {
      return res.status(403).json({ message: 'Bar financial access required' });
    }
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
      if (getPreparedBeverageType(item) && req.body?.cocktailServingsAuto === undefined) {
        item.cocktailServingsAuto = false;
      }
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
    if (req.body?.cocktailRecipeKey !== undefined) item.cocktailRecipeKey = cleanString(req.body.cocktailRecipeKey, 80);
    if (req.body?.cocktailServingsAuto !== undefined) {
      item.cocktailServingsAuto = cleanBoolean(req.body.cocktailServingsAuto, item.cocktailServingsAuto);
      if (item.cocktailServingsAuto && getPreparedBeverageType(item)) {
        item.sentQty = cocktailServingsForGuests(event.guestCount);
        item.sentQtyText = String(item.sentQty);
      }
    }
    if (req.body?.clientProvidedIngredients !== undefined) {
      item.clientProvidedIngredients = (Array.isArray(req.body.clientProvidedIngredients) ? req.body.clientProvidedIngredients : [])
        .slice(0, 30)
        .map((value) => cleanString(value, 120))
        .filter(Boolean);
    }
    if (req.body?.batchInstructions !== undefined) item.batchInstructions = cleanString(req.body.batchInstructions, 2000);
    if (req.body?.prepTask !== undefined) {
      const requestedTask = req.body.prepTask && typeof req.body.prepTask === 'object'
        ? req.body.prepTask
        : {};
      const scheduledDate = cleanString(requestedTask.scheduledDate, 10);
      if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return res.status(400).json({ message: 'Prep date must use YYYY-MM-DD format' });
      }
      const username = String(req.auth?.username || req.auth?.email || '');
      const previousDate = String(item.prepTask?.scheduledDate || '');
      item.prepTask.scheduledDate = scheduledDate;
      if (requestedTask.assigneeStaffId !== undefined || requestedTask.assigneeName !== undefined) {
        const assignee = await resolveBarTaskAssignee(requestedTask);
        item.prepTask.assigneeStaffId = assignee.assigneeStaffId;
        item.prepTask.assigneeName = assignee.assigneeName;
      }
      if (requestedTask.priority !== undefined) {
        const priority = cleanString(requestedTask.priority, 20).toLowerCase();
        if (!['normal', 'important', 'urgent'].includes(priority)) {
          return res.status(400).json({ message: 'Task priority must be normal, important or urgent' });
        }
        item.prepTask.priority = priority;
      }
      if (!scheduledDate) {
        item.prepTask.scheduledAt = null;
        item.prepTask.scheduledBy = '';
        item.prepTask.completedAt = null;
        item.prepTask.completedBy = '';
      } else {
        if (scheduledDate !== previousDate || !item.prepTask.scheduledAt) {
          item.prepTask.scheduledAt = new Date();
          item.prepTask.scheduledBy = username;
        }
        const completed = cleanBoolean(requestedTask.completed, Boolean(item.prepTask.completedAt));
        item.prepTask.completedAt = completed ? (item.prepTask.completedAt || new Date()) : null;
        item.prepTask.completedBy = completed ? (item.prepTask.completedBy || username) : '';
      }
    }
    item.updatedBy = String(req.auth?.username || req.auth?.email || '');
    item.updatedAt = new Date();
    event.revision += 1;
    addAudit(event, req.auth, req.body?.prepTask !== undefined ? 'cocktail_prep_task_updated' : 'packout_item_updated', { itemId: String(item._id) });
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
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
      includeFinancials: canSeeBarFinancials(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar return update failed',
      fallbackMessage: 'Failed to update returned quantity',
    });
  }
});

router.patch('/events/:id/returns', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canOperateEvent(event, req.auth)) {
      return res.status(403).json({ message: 'Bar operation access required' });
    }
    if (event.status === 'closed') {
      return res.status(409).json({ message: 'This event bar report is closed' });
    }
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rows.length || rows.length > MAX_PACKOUT_ITEMS) {
      return res.status(400).json({ message: `Provide between 1 and ${MAX_PACKOUT_ITEMS} return items` });
    }

    const manager = isBarManager(req.auth);
    const seen = new Set();
    const updates = [];
    for (const row of rows) {
      const itemId = cleanString(row?.itemId, 80);
      if (!isObjectId(itemId) || seen.has(itemId)) {
        return res.status(400).json({ message: 'Every return item must have a unique itemId' });
      }
      seen.add(itemId);
      const item = event.items.id(itemId);
      if (!item || item.included === false || !requiresBarReturn(item)) {
        return res.status(404).json({ message: 'Packout return item not found' });
      }
      if (!manager && item.returnConfirmed === true) {
        return res.status(409).json({ message: `${item.name || 'Item'} was already saved` });
      }
      const returnedQty = Number(row?.returnedQty);
      if (!Number.isFinite(returnedQty) || returnedQty < 0) {
        return res.status(400).json({ message: `${item.name || 'Item'} returned quantity must be zero or greater` });
      }
      const returnValidation = validateBarReturnQuantities({
        ...item.toObject(),
        returnedFullQty: 0,
        returnedOpenQty: returnedQty,
        lostDamagedQty: 0,
      });
      if (!returnValidation.valid) {
        return res.status(400).json({
          message: `${item.name || 'Item'}: ${returnValidation.message}`,
          accounting: returnValidation.accounting,
        });
      }
      updates.push({
        item,
        returnedQty,
        captainNotes: cleanString(row?.captainNotes, 1000),
      });
    }

    const updatedAt = new Date();
    const updatedBy = String(req.auth?.username || req.auth?.email || '');
    updates.forEach(({ item, returnedQty, captainNotes }) => {
      item.returnedFullQty = 0;
      item.returnedOpenQty = returnedQty;
      item.lostDamagedQty = 0;
      item.captainNotes = captainNotes;
      item.returnConfirmed = true;
      item.updatedBy = updatedBy;
      item.updatedAt = updatedAt;
    });
    if (event.status === 'ready') event.status = 'in_progress';
    event.revision += 1;
    addAudit(event, req.auth, 'returns_batch_updated', { count: updates.length });
    await event.save();
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar returns batch update failed',
      fallbackMessage: 'Failed to save returned quantities',
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
      item.included !== false
      && isBarAccountingItem(item)
      && requiresBarReturn(item)
      && item.returnConfirmed !== true
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
      includeFinancials: canSeeBarFinancials(req.auth),
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
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
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
    return res.json(serializeBarEvent(event, { includeFinancials: canSeeBarFinancials(req.auth) }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Event bar report reopen failed',
      fallbackMessage: 'Failed to reopen the event bar report',
    });
  }
});

export default router;
