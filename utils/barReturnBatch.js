import { validateBarReturnQuantities } from './barEventAccounting.js';

const currentQuantity = (item, field) => Number(item?.[field] || 0);

export const prepareBarReturnBatchItem = (item, row = {}) => {
  const values = {
    returnedFullQty: currentQuantity(item, 'returnedFullQty'),
    returnedOpenQty: currentQuantity(item, 'returnedOpenQty'),
    lostDamagedQty: currentQuantity(item, 'lostDamagedQty'),
  };
  const supplied = {
    returnedFullQty: row?.returnedFullQty,
    returnedOpenQty: row?.returnedOpenQty ?? row?.returnedQty,
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
