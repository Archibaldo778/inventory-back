export const PREPARED_BEVERAGE_RATES = Object.freeze({
  cocktail: 3,
  mocktail: 1.5,
});

const sourceText = (item = {}) => `${String(item?.section || '')} ${String(item?.name || '')}`.trim();
const FOOD_MENU_SECTION_PATTERN = /^(?:\d+\s+)?(?:(?:first|second|third|fourth)\s+courses?|plated\s+desserts?|proteins?|sides?|salads?|soups?|appetizers?|hors\s+d[’']?oeuvres?|canap[eé]s?|entr[eé]es?|main\s+courses?|desserts?|breads?|starches?|vegetables?|vendor\s+meals?)\s*:?(?:\s*\([^)]*\))?$/i;
export const isFoodMenuItem = (item = {}) => (
  FOOD_MENU_SECTION_PATTERN.test(String(item?.name || '').trim())
  || FOOD_MENU_SECTION_PATTERN.test(String(item?.section || '').trim())
);
const isPreparedBeverageSupportRow = (item = {}) => (
  /\b(?:garnish|ice|water|cups?|glassware|napkins?|straws?|mixers?|juices?|sodas?)\b/i
    .test(String(item?.name || '').trim())
);

export const getPreparedBeverageType = (item = {}) => {
  const section = String(item?.section || '').trim();
  if (isFoodMenuItem(item)) return '';
  const explicitType = /^\s*mocktails?\s*$/i.test(section)
    ? 'mocktail'
    : (/^\s*(?:specialty\s+)?cocktails?\s*$/i.test(section) ? 'cocktail' : '');
  if (explicitType) {
    if (/\b(?:garnish|ice|cups?|glassware|napkins?|straws?|mixers?|juices?|sodas?)\b/i.test(String(item?.name || '').trim())) return '';
    return explicitType;
  }
  if (String(item?.scope || '') === 'alcohol') return '';
  if (isPreparedBeverageSupportRow(item)) return '';
  const source = sourceText(item);
  if (/\bmocktails?\b/i.test(source)) return 'mocktail';
  if (/\bcocktails?\b/i.test(source)) return 'cocktail';
  return '';
};

export const getPreparedBeverageRate = (item = {}) => (
  PREPARED_BEVERAGE_RATES[getPreparedBeverageType(item)] || null
);

export const isTrackedBarWater = (item = {}) => (
  /\b(?:acqua\s+)?panna\b|\b(?:s\.?\s*)?pellegrino\b/i.test(String(item?.name || '').trim())
);

export const isExternalJelloItem = (item = {}) => (
  /\b(?:jell[\s-]*o|jello)\s*(?:shots?|bar|station|wiggles?)\b/i.test(sourceText(item))
);

export const isBarAccountingItem = (item = {}) => (
  !isExternalJelloItem(item)
  && !isFoodMenuItem(item)
  && (
    String(item?.scope || '') === 'alcohol'
    || isTrackedBarWater(item)
    || Boolean(getPreparedBeverageType(item))
  )
);

export const requiresBarReturn = (item = {}) => !getPreparedBeverageType(item);
