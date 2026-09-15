import { getPreparedBeverageRate, getPreparedBeverageType } from './barPackoutScope.js';

const clean = (value) => String(value ?? '').trim();
const sourceText = (item = {}) => [
  item?.subCategory,
  item?.category,
  ...(Array.isArray(item?.categories) ? item.categories : []),
  item?.section,
  item?.name,
].map(clean).filter(Boolean).join(' ');

const FAMILY_RULES = [
  ['sparkling_wine', /\b(?:champagne|prosecco|cava|sparkling|brut)\b/i],
  ['rose_wine', /\b(?:ros[eé]|provence)\b/i],
  ['white_wine', /\b(?:white\s+wine|sancerre|chablis|chardonnay|sauvignon|pinot\s+grigio|pinot\s+blanc|riesling)\b/i],
  ['red_wine', /\b(?:red\s+wine|cabernet|merlot|pinot\s+noir|bordeaux|c[oô]tes?\s+du\s+rh[oô]ne|syrah|shiraz|malbec)\b/i],
  ['vodka', /\b(?:vodka|ketel\s+one|belvedere|grey\s+goose|tito'?s|absolut|stolichnaya|stoli)\b/i],
  ['gin', /\b(?:gin|hendricks?|beefeater|tanqueray|bombay\s+sapphire)\b/i],
  ['tequila', /\b(?:tequila|patr[oó]n|casamigos|espol[oó]n|don\s+julio)\b/i],
  ['mezcal', /\bmezcal\b/i],
  ['whiskey', /\b(?:whisk(?:e)?y|bourbon|scotch|rye|bulleit|michter'?s|macallan|johnnie\s+walker)\b/i],
  ['rum', /\b(?:rum|bacardi|el\s+dorado)\b/i],
  ['cognac', /\b(?:cognac|brandy)\b/i],
  ['vermouth', /\bvermouth\b/i],
  ['liqueur', /\b(?:liqueur|amaro|aperitif|digestif|bitters|aperol|campari|cura[cç]ao)\b/i],
];

const WINE_FAMILIES = new Set(['sparkling_wine', 'rose_wine', 'white_wine', 'red_wine', 'wine']);

export const barCostFamily = (item = {}) => {
  const text = sourceText(item);
  const matched = FAMILY_RULES.find(([, pattern]) => pattern.test(text));
  if (matched) return matched[0];
  if (/\bwines?\b/i.test(text)) return 'wine';
  if (/\b(?:hard\s+liquors?|liquors?|spirits?|alcohol)\b/i.test(text)) return 'spirit';
  return '';
};

const unitCost = (item = {}) => {
  const purchaseCost = Number(item?.purchaseCost);
  if (Number.isFinite(purchaseCost) && purchaseCost > 0) return purchaseCost;
  const caseCost = Number(item?.caseCost);
  const caseSize = Number(item?.caseSize);
  if (Number.isFinite(caseCost) && caseCost > 0 && Number.isFinite(caseSize) && caseSize > 0) {
    return caseCost / caseSize;
  }
  return null;
};

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const familyLabel = (family) => ({
  sparkling_wine: 'sparkling wine',
  rose_wine: 'rosé wine',
  white_wine: 'white wine',
  red_wine: 'red wine',
  wine: 'wine',
  vodka: 'vodka',
  gin: 'gin',
  tequila: 'tequila',
  mezcal: 'mezcal',
  whiskey: 'whiskey',
  rum: 'rum',
  cognac: 'cognac / brandy',
  vermouth: 'vermouth',
  liqueur: 'liqueur / aperitif',
  spirit: 'spirit',
}[family] || family);

export const estimateBarItemUnitCost = (item = {}, catalog = []) => {
  const preparedType = getPreparedBeverageType(item);
  const preparedRate = getPreparedBeverageRate(item);
  if (preparedType && preparedRate !== null) {
    return {
      unitCost: preparedRate,
      estimate: {
        estimated: false,
        kind: preparedType,
        basis: `Fixed ${preparedType} prep rate`,
        needsPriceCheck: false,
      },
    };
  }

  const family = barCostFamily(item);
  if (!family) return null;
  const source = Array.isArray(catalog) ? catalog : [];
  let peers = source.filter((candidate) => barCostFamily(candidate) === family && unitCost(candidate) !== null);
  if (!peers.length && WINE_FAMILIES.has(family)) {
    peers = source.filter((candidate) => WINE_FAMILIES.has(barCostFamily(candidate)) && unitCost(candidate) !== null);
  }
  if (!peers.length && !WINE_FAMILIES.has(family)) {
    peers = source.filter((candidate) => {
      const candidateFamily = barCostFamily(candidate);
      return candidateFamily && !WINE_FAMILIES.has(candidateFamily) && unitCost(candidate) !== null;
    });
  }
  const estimatedCost = median(peers.map(unitCost));
  if (estimatedCost === null) return null;
  const label = familyLabel(family);
  return {
    unitCost: Math.round((estimatedCost + Number.EPSILON) * 100) / 100,
    estimate: {
      estimated: true,
      kind: family,
      basis: `${label} inventory median (${peers.length})`,
      needsPriceCheck: WINE_FAMILIES.has(family),
    },
  };
};
