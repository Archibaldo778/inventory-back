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
