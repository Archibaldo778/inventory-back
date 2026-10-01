import { validateBarReturnQuantities } from './barEventAccounting.js';

const currentQuantity = (item, field) => Number(item?.[field] || 0);

export const prepareBarReturnBatchItem = (item, row = {}) => {
  const values = {
    returnedFullQty: currentQuantity(item, 'returnedFullQty'),
    returnedOpenQty: currentQuantity(item, 'returnedOpenQty'),
    lostDamagedQty: currentQuantity(item, 'lostDamagedQty'),
  };
  // The returns table edits one total (full + open). When only that total is
  // sent it replaces both parts; keeping the old full count would add it twice.
  const totalOnly = row?.returnedQty !== undefined
    && row?.returnedFullQty === undefined
    && row?.returnedOpenQty === undefined;
  const supplied = {
    returnedFullQty: totalOnly ? 0 : row?.returnedFullQty,
    returnedOpenQty: totalOnly ? row.returnedQty : row?.returnedOpenQty,
    lostDamagedQty: row?.lostDamagedQty,
  };
  for (const field of Object.keys(values)) {
    if (supplied[field] === undefined) continue;
    const numeric = Number(supplied[field]);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { valid: false, message: `${field} must be zero or greater` };
    }
    if (field === 'returnedFullQty' && !Number.isInteger(numeric)) {
      return { valid: false, message: 'Full returned quantity must be a whole number' };
    }
    values[field] = numeric;
  }
  const validation = validateBarReturnQuantities({
    ...(typeof item?.toObject === 'function' ? item.toObject() : item),
    ...values,
  });
  return { ...validation, values };
};
