import { requiresBarReturn } from './barPackoutScope.js';

const itemId = (item) => String(item?._id || item?.id || '');
const itemName = (item) => String(item?.name || 'Unnamed item').trim() || 'Unnamed item';

const recordSentQuantityChange = (item, sentQty, { at, by, userId = '', audit }) => {
  const oldValue = Number(item.sentQty || 0);
  if (item.sentQtyPending === true || oldValue === sentQty) return;
  if (item.sentQtyOriginal === undefined || item.sentQtyOriginal === null) item.sentQtyOriginal = oldValue;
  item.sentQtyChangedBy = String(by || '');
  item.sentQtyChangedAt = at;
  audit.push({
    action: 'guest_sent_qty_changed', username: String(by || ''), userId: String(userId || ''), at,
    details: { itemId: itemId(item), name: itemName(item), oldValue, newValue: sentQty },
  });
};

const indexGuestRows = (required, rows, action) => {
  const requiredById = new Map(required.map((item) => [itemId(item), item]));
  const byId = new Map();
  const duplicates = [];
  const unexpected = [];
  for (const row of rows) {
    const id = String(row?.itemId || '').trim();
    if (!id || !requiredById.has(id)) {
      unexpected.push(id || 'unknown item');
      continue;
    }
    if (byId.has(id)) {
      duplicates.push(itemName(requiredById.get(id)));
      continue;
    }
    byId.set(id, row);
  }
  const missing = required.filter((item) => !byId.has(itemId(item))).map(itemName);
  if (missing.length) return { valid: false, message: `Missing ${action} quantity for: ${missing.join(', ')}`, byId };
  if (duplicates.length) return { valid: false, message: `Duplicate ${action} item: ${duplicates.join(', ')}`, byId };
  if (unexpected.length) return { valid: false, message: `Unexpected ${action} item: ${unexpected.join(', ')}`, byId };
  return { valid: true, message: '', byId };
};

export const applyGuestReceivedRows = (items, rows, { at = new Date(), by = '', userId = '', audit = [] } = {}) => {
  const required = (Array.isArray(items) ? items : []).filter((item) => item?.included !== false && requiresBarReturn(item));
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!required.length) return { valid: false, message: 'This event has no receivable items', count: 0 };
  const indexed = indexGuestRows(required, sourceRows, 'received');
  if (!indexed.valid) return { valid: false, message: indexed.message, count: 0 };
  const { byId } = indexed;
  const updates = [];
  for (const item of required) {
    const row = byId.get(String(item?._id || item?.id || ''));
    const deliveredQty = Number(row?.deliveredQty);
    const sentQty = row?.sentQty === undefined
      ? (item?.sentQtyPending === true ? deliveredQty : Number(item?.sentQty || 0))
      : Number(row.sentQty);
    if (!Number.isFinite(sentQty) || sentQty < 0) {
      return { valid: false, message: `Enter a valid sent quantity for ${item?.name || 'item'}`, count: 0 };
    }
    if (!row || !Number.isFinite(deliveredQty) || deliveredQty < 0) {
      return { valid: false, message: `Enter a valid received quantity for ${item?.name || 'item'}`, count: 0 };
    }
    updates.push({ item, sentQty, deliveredQty });
  }
  updates.forEach(({ item, sentQty, deliveredQty }) => {
    recordSentQuantityChange(item, sentQty, { at, by, userId, audit });
    item.sentQty = sentQty;
    item.sentQtyText = String(sentQty);
    item.sentQtyPending = false;
    item.deliveredQty = deliveredQty;
    item.updatedBy = String(by || '');
    item.updatedAt = at;
  });
  return { valid: true, message: '', count: updates.length };
};

export const prepareGuestReturnRows = (items, rows) => {
  const required = (Array.isArray(items) ? items : []).filter((item) => item?.included !== false && requiresBarReturn(item));
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!required.length) return { valid: false, message: 'This event has no returnable items', updates: [], variances: [] };
  const indexed = indexGuestRows(required, sourceRows, 'returned');
  if (!indexed.valid) return { valid: false, message: indexed.message, updates: [], variances: [] };
  const { byId } = indexed;
  const updates = [];
  const variances = [];
  const unverifiedReceived = [];
  for (const item of required) {
    const itemId = String(item?._id || item?.id || '');
    const row = byId.get(itemId);
    const deliveredValue = row?.deliveredQty;
    const savedDeliveredQty = item?.deliveredQty === null || item?.deliveredQty === undefined || item?.deliveredQty === ''
      ? null
      : Number(item.deliveredQty);
    const deliveredQty = deliveredValue === null || deliveredValue === undefined || deliveredValue === ''
      ? (Number.isFinite(savedDeliveredQty) && savedDeliveredQty >= 0 ? savedDeliveredQty : null)
      : Number(deliveredValue);
    const returnedQty = Number(row?.returnedQty);
    const sentValue = row?.sentQty;
    const sentQty = sentValue === undefined
      ? (item?.sentQtyPending === true
        ? Math.max(Number(item.sentQty || 0), deliveredQty ?? 0, returnedQty)
        : Number(item.sentQty || 0))
      : Number(sentValue);
    if (!Number.isFinite(sentQty) || sentQty < 0) {
      return { valid: false, message: `Enter a valid sent quantity for ${item?.name || 'item'}`, updates: [], variances: [], unverifiedReceived: [] };
    }
    if (deliveredQty !== null && (!Number.isFinite(deliveredQty) || deliveredQty < 0)) {
      return { valid: false, message: `Enter a valid received quantity for ${item?.name || 'item'} or leave it blank`, updates: [], variances: [], unverifiedReceived: [] };
    }
    if (!Number.isFinite(returnedQty) || returnedQty < 0) {
      return { valid: false, message: `Enter a valid returned quantity for ${item?.name || 'item'}`, updates: [], variances: [], unverifiedReceived: [] };
    }
    const difference = deliveredQty === null ? 0 : Math.round((returnedQty - deliveredQty) * 10000) / 10000;
    if (deliveredQty === null) {
      unverifiedReceived.push({ itemId, name: String(item?.name || 'Item'), returnedQty });
    } else if (difference > 0.0001) {
      variances.push({ itemId, name: String(item?.name || 'Item'), deliveredQty, returnedQty, difference });
    }
    updates.push({ item, sentQty, deliveredQty, returnedQty });
  }
  return { valid: true, message: '', updates, variances, unverifiedReceived };
};

export const applyGuestReturnRows = (items, rows, { at = new Date(), by = '', userId = '', audit = [] } = {}) => {
  const prepared = prepareGuestReturnRows(items, rows);
  if (!prepared.valid) return prepared;
  prepared.updates.forEach(({ item, sentQty, deliveredQty, returnedQty }) => {
    recordSentQuantityChange(item, sentQty, { at, by, userId, audit });
    item.sentQty = sentQty;
    item.sentQtyText = String(sentQty);
    item.sentQtyPending = false;
    if (deliveredQty !== null) item.deliveredQty = deliveredQty;
    item.returnedFullQty = 0;
    item.returnedOpenQty = returnedQty;
    item.lostDamagedQty = 0;
    item.returnConfirmed = true;
    item.updatedBy = String(by || '');
    item.updatedAt = at;
  });
  return prepared;
};
