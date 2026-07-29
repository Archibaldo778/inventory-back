export const BEVERAGE_INVENTORY_MOVEMENT_TYPES = Object.freeze([
  'receive',
  'return',
  'usage',
  'waste',
  'adjustment',
]);

const MOVEMENT_TYPE_SET = new Set(BEVERAGE_INVENTORY_MOVEMENT_TYPES);

export const resolveBeverageInventoryDelta = (type, value) => {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!MOVEMENT_TYPE_SET.has(normalizedType)) return null;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 1_000_000) return null;
  if (normalizedType === 'adjustment') return quantity;
  const absolute = Math.abs(quantity);
  return ['usage', 'waste'].includes(normalizedType) ? -absolute : absolute;
};
