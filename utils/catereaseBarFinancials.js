import { classifyRecognizedSection, normalizeOcrCatalogName } from './barPackoutRecognition.js';

const clean = (value) => String(value ?? '').trim();
const moneyOrNull = (value) => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

const nonNegativeNumberOrNull = (value) => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const isBilledBeverageLine = (lineItem = {}) => {
  const billingKind = `${clean(lineItem?.category)} ${clean(lineItem?.type)}`;
  if (/\b(?:beverage|liquor|alcohol|spirits?|wines?|beer)\b/i.test(billingKind)) return true;
  if (billingKind.trim()) return false;
  const name = clean(lineItem?.name);
  return classifyRecognizedSection(name) === 'alcohol'
    || /\b(?:cocktails?|mocktails?|beverages?)\b/i.test(name);
};

export const catereaseBundleLineItems = (bundle = {}) => {
  const include = bundle?.includes?.lineItems;
  if (!include || include?._status === 'error') return [];
  const rows = include?.data ?? include;
  return Array.isArray(rows) ? rows : [];
};

export const catereaseBilledBeverageCharges = (lineItems = []) => {
  const seen = new Set();
  const billedLineItems = [];
  (Array.isArray(lineItems) ? lineItems : []).forEach((lineItem) => {
    const lineTotal = moneyOrNull(lineItem?.lineTotal);
    if (lineTotal === null || lineTotal <= 0 || !isBilledBeverageLine(lineItem)) return;
    const source = clean(lineItem?.id);
    const dedupeKey = source || [
      clean(lineItem?.name).toLowerCase(),
      clean(lineItem?.category).toLowerCase(),
      clean(lineItem?.type).toLowerCase(),
      lineTotal,
    ].join('|');
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    billedLineItems.push({
      source,
      name: clean(lineItem?.name),
      category: clean(lineItem?.category),
      type: clean(lineItem?.type),
      quantity: nonNegativeNumberOrNull(lineItem?.quantity),
      unitPrice: moneyOrNull(lineItem?.unitPrice),
      lineTotal,
    });
  });
  return {
    lineItems: billedLineItems,
    total: Math.round(billedLineItems.reduce((sum, lineItem) => sum + lineItem.lineTotal, 0) * 100) / 100,
  };
};

export const applyCatereaseAlcoholClientCharges = (items = [], lineItems = []) => {
  const barItems = Array.isArray(items) ? items : [];
  const alcoholItemsByName = new Map();
  barItems.forEach((item, index) => {
    if (item?.scope !== 'alcohol') return;
    const key = normalizeOcrCatalogName(item?.name);
    if (key && !alcoholItemsByName.has(key)) alcoholItemsByName.set(key, { item, index });
  });

  const matches = new Map();
  let alcoholLineItems = 0;
  let unmatchedAlcoholLineItems = 0;
  (Array.isArray(lineItems) ? lineItems : []).forEach((lineItem) => {
    const name = clean(lineItem?.name);
    if (!name || classifyRecognizedSection(name) !== 'alcohol') return;
    alcoholLineItems += 1;
    const target = alcoholItemsByName.get(normalizeOcrCatalogName(name));
    if (!target) {
      unmatchedAlcoholLineItems += 1;
      return;
    }
    const unitPrice = moneyOrNull(lineItem?.unitPrice);
    const lineTotal = moneyOrNull(lineItem?.lineTotal);
    if (unitPrice === null && lineTotal === null) return;
    const current = matches.get(target.index) || { target, unitPrices: [], lineTotal: 0, hasLineTotal: false, sources: [], lineItems: 0 };
    if (unitPrice !== null) current.unitPrices.push(unitPrice);
    if (lineTotal !== null) {
      current.lineTotal += lineTotal;
      current.hasLineTotal = true;
    }
    const source = clean(lineItem?.id);
    if (source && !current.sources.includes(source)) current.sources.push(source);
    current.lineItems += 1;
    matches.set(target.index, current);
  });

  if (matches.size) {
    barItems.forEach((item) => {
      if (item?.scope === 'alcohol') item.clientChargeSnapshot = { unitPrice: null, lineTotal: null, source: '' };
    });
    matches.forEach((match) => {
      const firstPrice = match.unitPrices[0] ?? null;
      const sameUnitPrice = match.unitPrices.every((price) => price === firstPrice);
      match.target.item.clientChargeSnapshot = {
        unitPrice: sameUnitPrice ? firstPrice : null,
        lineTotal: match.hasLineTotal ? Math.round(match.lineTotal * 100) / 100 : null,
        source: match.sources.join(','),
      };
    });
  }

  const lineItemChargeTotal = [...matches.values()].reduce((total, match) => (
    total + (match.hasLineTotal ? match.lineTotal : 0)
  ), 0);
  const billedBeverageCharges = catereaseBilledBeverageCharges(lineItems);
  return {
    alcoholLineItems,
    matchedItems: matches.size,
    matchedLineItems: [...matches.values()].reduce((total, match) => total + match.lineItems, 0),
    unmatchedAlcoholLineItems,
    lineItemChargeTotal: Math.round(lineItemChargeTotal * 100) / 100,
    billedBeverageLineItems: billedBeverageCharges.lineItems.length,
    billedBeverageTotal: billedBeverageCharges.total,
    billedBeverageCharges: billedBeverageCharges.lineItems,
  };
};

export const applyCatereaseAlcoholClientChargesFromBundle = (items, bundle) => (
  applyCatereaseAlcoholClientCharges(items, catereaseBundleLineItems(bundle))
);
