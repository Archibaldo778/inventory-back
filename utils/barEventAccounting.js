const toNonNegativeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const round = (value, precision = 4) => {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

export const calculateBarItemAccounting = (item = {}) => {
  const sentQty = toNonNegativeNumber(item.sentQty);
  const returnedFullQty = toNonNegativeNumber(item.returnedFullQty);
  const returnedOpenQty = toNonNegativeNumber(item.returnedOpenQty);
  const returnedQty = round(returnedFullQty + returnedOpenQty);
  const usedQty = round(Math.max(0, sentQty - returnedQty));
  const overReturnedQty = round(Math.max(0, returnedQty - sentQty));
  const unitCost = toNonNegativeNumber(item.unitCostSnapshot);
  const actualCost = round(usedQty * unitCost, 2);
  return {
    sentQty,
    returnedFullQty,
    returnedOpenQty,
    returnedQty,
    usedQty,
    overReturnedQty,
    unitCost,
    actualCost,
  };
};

export const calculateBarEventAccounting = (event = {}) => {
  const sourceItems = Array.isArray(event.items) ? event.items : [];
  const lines = sourceItems.map((item) => ({
    item,
    accounting: calculateBarItemAccounting(item),
  }));
  const includedLines = lines.filter(({ item }) => item?.included !== false);
  const inventoryCost = round(
    includedLines.reduce((sum, line) => sum + line.accounting.actualCost, 0),
    2
  );
  const clientCharge = round(toNonNegativeNumber(event.clientCharge), 2);
  const grossProfit = round(clientCharge - inventoryCost, 2);
  const marginPercent = clientCharge > 0
    ? round((grossProfit / clientCharge) * 100, 2)
    : null;
  return {
    inventoryCost,
    clientCharge,
    grossProfit,
    marginPercent,
    includedItemCount: includedLines.length,
    confirmedItemCount: includedLines.filter(({ item }) => item?.returnConfirmed === true).length,
  };
};
