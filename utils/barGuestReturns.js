import { requiresBarReturn } from './barPackoutScope.js';

export const applyGuestReceivedRows = (items, rows, { at = new Date(), by = '' } = {}) => {
  const required = (Array.isArray(items) ? items : []).filter((item) => item?.included !== false && requiresBarReturn(item));
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!required.length) return { valid: false, message: 'This event has no receivable items', count: 0 };
  if (sourceRows.length !== required.length) return { valid: false, message: 'Enter a received quantity for every item', count: 0 };
  const byId = new Map(sourceRows.map((row) => [String(row?.itemId || '').trim(), row]));
  const updates = [];
  for (const item of required) {
    const row = byId.get(String(item?._id || item?.id || ''));
    const deliveredQty = Number(row?.deliveredQty);
    if (!row || !Number.isFinite(deliveredQty) || deliveredQty < 0) {
      return { valid: false, message: `Enter a valid received quantity for ${item?.name || 'item'}`, count: 0 };
    }
    updates.push({ item, deliveredQty });
  }
  updates.forEach(({ item, deliveredQty }) => {
    if (item.sentQtyPending === true) {
      item.sentQty = deliveredQty;
      item.sentQtyText = String(deliveredQty);
      item.sentQtyPending = false;
    }
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
  if (sourceRows.length !== required.length) {
    return { valid: false, message: 'Enter a returned quantity for every item', updates: [], variances: [] };
  }
  const byId = new Map();
  for (const row of sourceRows) {
    const itemId = String(row?.itemId || '').trim();
    if (!itemId || byId.has(itemId)) {
      return { valid: false, message: 'Every returned item must appear exactly once', updates: [], variances: [] };
    }
    byId.set(itemId, row);
  }
  const updates = [];
  const variances = [];
  for (const item of required) {
    const itemId = String(item?._id || item?.id || '');
    const row = byId.get(itemId);
    const deliveredQty = Number(row?.deliveredQty);
    const returnedQty = Number(row?.returnedQty);
    if (!row || !Number.isFinite(deliveredQty) || deliveredQty < 0) {
      return { valid: false, message: `Enter a valid received quantity for ${item?.name || 'item'}`, updates: [], variances: [] };
    }
    if (!Number.isFinite(returnedQty) || returnedQty < 0) {
      return { valid: false, message: `Enter a valid returned quantity for ${item?.name || 'item'}`, updates: [], variances: [] };
    }
    const pendingSentQty = item.sentQtyPending === true
      ? Math.max(Number(item.sentQty || 0), deliveredQty, returnedQty)
      : Number(item.sentQty || 0);
    const difference = Math.round((returnedQty - deliveredQty) * 10000) / 10000;
    if (difference > 0.0001) {
      variances.push({ itemId, name: String(item?.name || 'Item'), deliveredQty, returnedQty, difference });
    }
    updates.push({ item, deliveredQty, returnedQty, pendingSentQty });
  }
  return { valid: true, message: '', updates, variances };
};
