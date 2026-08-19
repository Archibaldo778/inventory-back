const toNonNegativeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const toOptionalNonNegativeNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const round = (value, precision = 4) => {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

export const calculateBarItemAccounting = (item = {}) => {
  const sentQty = toNonNegativeNumber(item.sentQty);
  const deliveredQty = toOptionalNonNegativeNumber(item.deliveredQty);
  const outboundQty = deliveredQty ?? sentQty;
  const returnedFullQty = toNonNegativeNumber(item.returnedFullQty);
  const returnedOpenQty = toNonNegativeNumber(item.returnedOpenQty);
  const lostDamagedQty = toNonNegativeNumber(item.lostDamagedQty);
  const returnedQty = round(returnedFullQty + returnedOpenQty);
  const usedQty = round(Math.max(0, outboundQty - returnedQty));
  const consumedQty = round(Math.max(0, outboundQty - returnedQty - lostDamagedQty));
  const overReturnedQty = round(Math.max(0, returnedQty - outboundQty));
  const overAccountedQty = round(Math.max(0, returnedQty + lostDamagedQty - outboundQty));
  const unitCost = toNonNegativeNumber(item.unitCostSnapshot);
  const actualCost = round(usedQty * unitCost, 2);
  return {
    sentQty,
    deliveredQty,
    outboundQty,
    returnedFullQty,
    returnedOpenQty,
    returnedQty,
    lostDamagedQty,
    consumedQty,
    usedQty,
    overReturnedQty,
    overAccountedQty,
    unitCost,
    actualCost,
  };
};

export const validateBarReturnQuantities = (item = {}) => {
  const accounting = calculateBarItemAccounting(item);
  if (accounting.overAccountedQty > 0) {
    return {
      valid: false,
      message: `Returns plus lost/damaged cannot exceed ${accounting.outboundQty} sent to the event`,
      accounting,
    };
  }
  return { valid: true, message: '', accounting };
};

export const calculateBarPackageCharge = (event = {}) => {
  const packageSnapshot = event?.packageSnapshot && typeof event.packageSnapshot === 'object'
    ? event.packageSnapshot
    : {};
  const baseRate = toNonNegativeNumber(packageSnapshot.baseRate);
  const overrideRate = toOptionalNonNegativeNumber(packageSnapshot.overrideRate);
  const effectiveRate = overrideRate ?? baseRate;
  const priceUnit = ['per_person', 'per_hour', 'flat', 'per_unit'].includes(packageSnapshot.priceUnit)
    ? packageSnapshot.priceUnit
    : 'flat';
  const serviceHours = toOptionalNonNegativeNumber(packageSnapshot.serviceHours) ?? 0;
  const includedHours = toOptionalNonNegativeNumber(packageSnapshot.includedHours);
  const pricingQuantity = toOptionalNonNegativeNumber(packageSnapshot.pricingQuantity) ?? 0;
  const guestCount = toOptionalNonNegativeNumber(event?.guestCount) ?? 0;
  const multiplier = {
    per_person: guestCount,
    per_hour: serviceHours,
    per_unit: pricingQuantity,
    flat: 1,
  }[priceUnit];
  const baseCharge = round(effectiveRate * multiplier, 2);
  const additionalHours = priceUnit === 'per_hour' || includedHours === null
    ? 0
    : Math.max(0, serviceHours - includedHours);
  const additionalHourRate = toNonNegativeNumber(packageSnapshot.additionalHourRate);
  const overtimeCharge = round(additionalHours * additionalHourRate, 2);
  return {
    priceUnit,
    baseRate,
    overrideRate,
    effectiveRate,
    multiplier,
    baseCharge,
    serviceHours,
    includedHours,
    additionalHours: round(additionalHours),
    additionalHourRate,
    overtimeCharge,
    totalCharge: round(baseCharge + overtimeCharge, 2),
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
  const packageAccounting = calculateBarPackageCharge(event);
  return {
    inventoryCost,
    clientCharge,
    grossProfit,
    marginPercent,
    packageCharge: packageAccounting.totalCharge,
    packageAccounting,
    includedItemCount: includedLines.length,
    confirmedItemCount: includedLines.filter(({ item }) => item?.returnConfirmed === true).length,
  };
};
