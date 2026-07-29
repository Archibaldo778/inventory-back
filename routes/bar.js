import { Router } from 'express';
import mongoose from 'mongoose';
import BarEvent, { BAR_EVENT_STATUSES, BAR_ITEM_SCOPES, BAR_PRICE_UNITS } from '../models/BarEvent.js';
import BeverageItem from '../models/BeverageItem.js';
import User from '../models/Users.js';
import { isAdminAuth, normalizeRole } from '../middleware/auth.js';
import {
  calculateBarEventAccounting,
  calculateBarItemAccounting,
} from '../utils/barEventAccounting.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const BAR_MANAGER_ROLES = new Set(['bar admin']);
const BAR_WORKER_ROLES = new Set(['bar captain', 'bartender']);
const MAX_PACKOUT_ITEMS = 500;
const MAX_AUDIT_ENTRIES = 200;

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

const isAssigned = (event, auth) => {
  const userId = String(auth?.userId || '');
  return Boolean(userId) && (event?.assignedUserIds || []).some((id) => String(id) === userId);
};

const canAccessEvent = (event, auth) => isBarManager(auth) || (isBarWorker(auth) && isAssigned(event, auth));

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
  return event;
};

const requireBarManager = (req, res, next) => {
  if (!isBarManager(req.auth)) return res.status(403).json({ message: 'Bar admin access required' });
  return next();
};

const loadEvent = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400).json({ message: 'Invalid bar event id' });
    return null;
  }
  const event = await BarEvent.findById(req.params.id);
  if (!event) {
    res.status(404).json({ message: 'Bar event not found' });
    return null;
  }
  return event;
};

const normalizeAssignedUserIds = (value) => (
  [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(isObjectId))]
);

const normalizePackage = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const priceUnitCandidate = cleanString(source.priceUnit ?? previous.priceUnit, 30);
  return {
    name: cleanString(source.name ?? previous.name, 160),
    baseRate: cleanNumber(source.baseRate, {
      fallback: cleanNumber(previous.baseRate, { fallback: 0 }),
    }),
    overrideRate: cleanNumber(source.overrideRate, {
      fallback: cleanNumber(previous.overrideRate, { fallback: null }),
    }),
    priceUnit: BAR_PRICE_UNITS.includes(priceUnitCandidate) ? priceUnitCandidate : 'flat',
    additionalHourRate: cleanNumber(source.additionalHourRate, {
      fallback: cleanNumber(previous.additionalHourRate, { fallback: 0 }),
    }),
    serviceHours: cleanNumber(source.serviceHours, {
      fallback: cleanNumber(previous.serviceHours, { fallback: null }),
    }),
  };
};

const resolveCatalogById = async (items) => {
  const ids = [...new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item?.beverageItemId || '').trim())
    .filter(isObjectId))];
  if (!ids.length) return new Map();
  const catalog = await BeverageItem.find({ _id: { $in: ids } })
    .select('+purchaseCost +caseCost');
  return new Map(catalog.map((item) => [String(item._id), item]));
};

const normalizePackoutItems = async (items, { allowFinancials = false } = {}) => {
  const source = Array.isArray(items) ? items.slice(0, MAX_PACKOUT_ITEMS) : [];
  const catalogById = await resolveCatalogById(source);
  return source
    .map((item) => {
      const beverageItemId = isObjectId(item?.beverageItemId) ? String(item.beverageItemId) : null;
      const catalogItem = beverageItemId ? catalogById.get(beverageItemId) : null;
      const scope = BAR_ITEM_SCOPES.includes(cleanString(item?.scope, 30))
        ? cleanString(item.scope, 30)
        : 'review';
      const sentQty = cleanNumber(item?.sentQty ?? item?.quantity, { fallback: 0 });
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
        returnConfirmed: cleanBoolean(item?.returnConfirmed, false),
        unitCostSnapshot: allowFinancials
          ? cleanNumber(item?.unitCostSnapshot, {
            fallback: cleanNumber(catalogItem?.purchaseCost, { fallback: 0 }),
          })
          : cleanNumber(catalogItem?.purchaseCost, { fallback: 0 }),
        bottleSizeMl: cleanNumber(item?.bottleSizeMl, {
          fallback: cleanNumber(catalogItem?.bottleSizeMl, { fallback: null }),
        }),
        notes: cleanString(item?.notes, 1000),
        captainNotes: cleanString(item?.captainNotes, 1000),
      };
    })
    .filter((item) => item.name);
};

router.get('/users', requireBarManager, async (_req, res) => {
  try {
    const users = await User.find({
      role: { $in: ['bar admin', 'bar captain', 'bartender'] },
      isActive: { $ne: false },
    }).sort({ username: 1 });
    return res.json(users.map((user) => ({
      id: user._id,
      _id: user._id,
      username: user.username,
      email: user.email,
      role: normalizeRole(user.role),
    })));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar users list failed',
      fallbackMessage: 'Failed to list bar users',
    });
  }
});

router.get('/events', async (req, res) => {
  try {
    if (!isBarManager(req.auth) && !isBarWorker(req.auth)) {
      return res.status(403).json({ message: 'Bar access required' });
    }
    const query = isBarManager(req.auth)
      ? {}
      : { assignedUserIds: req.auth.userId };
    if (req.query.status && BAR_EVENT_STATUSES.includes(String(req.query.status))) {
      query.status = String(req.query.status);
    }
    const events = await BarEvent.find(query).sort({ eventDate: -1, createdAt: -1 });
    return res.json(events.map((event) => serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    })));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar events list failed',
      fallbackMessage: 'Failed to list bar events',
    });
  }
});

router.post('/events', requireBarManager, async (req, res) => {
  try {
    const name = cleanString(req.body?.name, 240);
    if (!name) return res.status(400).json({ message: 'Event name is required' });
    const event = new BarEvent({
      linkedEventId: isObjectId(req.body?.linkedEventId) ? req.body.linkedEventId : null,
      eventNumber: cleanString(req.body?.eventNumber, 80),
      name,
      eventDate: cleanString(req.body?.eventDate, 80),
      client: cleanString(req.body?.client, 180),
      venue: cleanString(req.body?.venue, 240),
      salesRep: cleanString(req.body?.salesRep, 160),
      eventTiming: cleanString(req.body?.eventTiming, 120),
      deliveryTime: cleanString(req.body?.deliveryTime, 120),
      guestCount: cleanNumber(req.body?.guestCount, { fallback: null }),
      assignedUserIds: normalizeAssignedUserIds(req.body?.assignedUserIds),
      packageSnapshot: normalizePackage(req.body?.packageSnapshot),
      clientCharge: cleanNumber(req.body?.clientCharge, { fallback: 0 }),
      currency: cleanString(req.body?.currency || 'USD', 10) || 'USD',
      notes: cleanString(req.body?.notes, 3000),
    });
    addAudit(event, req.auth, 'event_created');
    await event.save();
    return res.status(201).json(serializeBarEvent(event, { includeFinancials: true }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar event creation failed',
      fallbackMessage: 'Failed to create bar event',
    });
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    if (!canAccessEvent(event, req.auth)) {
      return res.status(403).json({ message: 'This bar event is not assigned to you' });
    }
    return res.json(serializeBarEvent(event, {
      includeFinancials: isBarManager(req.auth),
    }));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar event lookup failed',
      fallbackMessage: 'Failed to load bar event',
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
    if (req.body?.assignedUserIds !== undefined) {
      event.assignedUserIds = normalizeAssignedUserIds(req.body.assignedUserIds);
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
      context: 'Bar event update failed',
      fallbackMessage: 'Failed to update bar event',
    });
  }
});

router.post('/events/:id/packout', async (req, res) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return undefined;
    const manager = isBarManager(req.auth);
    if (!manager && !(isBarWorker(req.auth) && isAssigned(event, req.auth))) {
      return res.status(403).json({ message: 'This bar event is not assigned to you' });
    }
    if (!manager && event.items.length > 0) {
      return res.status(409).json({ message: 'A packout already exists. Ask a bar admin to replace it.' });
    }
    const sourceItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!sourceItems.length) return res.status(400).json({ message: 'Packout items are required' });
    if (sourceItems.length > MAX_PACKOUT_ITEMS) {
      return res.status(413).json({ message: `Packout is limited to ${MAX_PACKOUT_ITEMS} items` });
    }
    event.items = await normalizePackoutItems(sourceItems, { allowFinancials: manager });
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
    const catalogId = isObjectId(req.body?.beverageItemId) ? String(req.body.beverageItemId) : null;
    let catalogItem = null;
    if (catalogId) {
      catalogItem = await BeverageItem.findById(catalogId).select('+purchaseCost +caseCost');
      if (!catalogItem) return res.status(400).json({ message: 'Beverage catalog item not found' });
      item.beverageItemId = catalogItem._id;
    }
    if (req.body?.name !== undefined) item.name = cleanString(req.body.name, 240);
    if (!item.name) return res.status(400).json({ message: 'Item name is required' });
    if (req.body?.section !== undefined) item.section = cleanString(req.body.section, 160);
    if (req.body?.scope !== undefined && BAR_ITEM_SCOPES.includes(String(req.body.scope))) {
      item.scope = String(req.body.scope);
    }
    if (req.body?.included !== undefined) item.included = cleanBoolean(req.body.included, item.included);
    if (req.body?.sentQty !== undefined) item.sentQty = cleanNumber(req.body.sentQty, { fallback: 0 });
    if (req.body?.sentQtyText !== undefined) item.sentQtyText = cleanString(req.body.sentQtyText, 80);
    if (req.body?.deliveredQty !== undefined) item.deliveredQty = cleanNumber(req.body.deliveredQty, { fallback: null });
    if (req.body?.unitCostSnapshot !== undefined || catalogItem) {
      item.unitCostSnapshot = cleanNumber(req.body?.unitCostSnapshot, {
        fallback: cleanNumber(catalogItem?.purchaseCost, { fallback: item.unitCostSnapshot }),
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
    if (!canAccessEvent(event, req.auth)) {
      return res.status(403).json({ message: 'This bar event is not assigned to you' });
    }
    if (event.status === 'closed') {
      return res.status(409).json({ message: 'This bar event is closed' });
    }
    const item = event.items.id(req.params.itemId);
    if (!item || item.included === false) {
      return res.status(404).json({ message: 'Packout item not found' });
    }
    ['returnedFullQty', 'returnedOpenQty', 'lostDamagedQty'].forEach((field) => {
      if (req.body?.[field] !== undefined) {
        item[field] = cleanNumber(req.body[field], { fallback: 0 });
      }
    });
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
    if (!canAccessEvent(event, req.auth)) {
      return res.status(403).json({ message: 'This bar event is not assigned to you' });
    }
    if (event.status === 'closed') return res.status(409).json({ message: 'This bar event is closed' });
    const unconfirmed = event.items.filter((item) => item.included !== false && item.returnConfirmed !== true);
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
      context: 'Bar event review failed',
      fallbackMessage: 'Failed to review bar event',
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
      context: 'Bar event reopen failed',
      fallbackMessage: 'Failed to reopen bar event',
    });
  }
});

router.delete('/events/:id', requireBarManager, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid bar event id' });
    const deleted = await BarEvent.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Bar event not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Bar event deletion failed',
      fallbackMessage: 'Failed to delete bar event',
    });
  }
});

export default router;
