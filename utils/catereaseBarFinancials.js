import { classifyRecognizedSection, normalizeOcrCatalogName } from './barPackoutRecognition.js';

const clean = (value) => String(value ?? '').trim();
const moneyOrNull = (value) => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

export const catereaseBundleLineItems = (bundle = {}) => {
  const include = bundle?.includes?.lineItems;
  if (!include || include?._status === 'error') return [];
  const rows = include?.data ?? include;
  return Array.isArray(rows) ? rows : [];
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
  return {
    alcoholLineItems,
    matchedItems: matches.size,
    matchedLineItems: [...matches.values()].reduce((total, match) => total + match.lineItems, 0),
    unmatchedAlcoholLineItems,
    lineItemChargeTotal: Math.round(lineItemChargeTotal * 100) / 100,
  };
};

export const applyCatereaseAlcoholClientChargesFromBundle = (items, bundle) => (
  applyCatereaseAlcoholClientCharges(items, catereaseBundleLineItems(bundle))
);
