export const PREPARED_BEVERAGE_RATES = Object.freeze({
  cocktail: 3,
  mocktail: 1.5,
});

const sourceText = (item = {}) => `${String(item?.section || '')} ${String(item?.name || '')}`.trim();
const isPreparedBeverageSupportRow = (item = {}) => (
  /\b(?:garnish|ice|water|cups?|glassware|napkins?|straws?|mixers?|juices?|sodas?)\b/i
    .test(String(item?.name || '').trim())
);

export const getPreparedBeverageType = (item = {}) => {
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

export const isBarAccountingItem = (item = {}) => (
  String(item?.scope || '') === 'alcohol' || Boolean(getPreparedBeverageType(item))
);

export const requiresBarReturn = (item = {}) => !getPreparedBeverageType(item);
