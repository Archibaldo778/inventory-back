const COCKTAIL_RECIPE_NAMES = new Map([
  ['agave spice', 'agave-spice'],
  ['arm in arm', 'arm-in-arm'],
  ['barefoot in the grass', 'barefoot-in-the-grass'],
  ['bonfire nights', 'bonfire-nights'],
  ['cool breeze', 'cool-breeze'],
  ['early sunset', 'early-sunset'],
  ['golden negroni', 'golden-negroni'],
  ['maple old fashioned', 'maple-old-fashioned'],
  ['passion is in fashion', 'passion-is-in-fashion'],
  ['pick me up', 'pick-me-up'],
  ['spice of life', 'spice-of-life'],
  ['yuzu dream', 'yuzu-dream'],
  ['yuzu lychee dream', 'yuzu-dream'],
]);

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/\b(?:signature|cocktails?|mocktails?)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const resolveCocktailRecipeKey = (value) => {
  const source = normalize(value);
  if (!source) return '';
  for (const [name, key] of COCKTAIL_RECIPE_NAMES) {
    if (source === name || source.includes(name)) return key;
  }
  return '';
};

export const cocktailServingsForGuests = (guestCount) => {
  const guests = Number(guestCount);
  return Number.isFinite(guests) && guests > 0 ? Math.ceil(guests * 1.3) : 0;
};

