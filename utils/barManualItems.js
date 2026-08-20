const normalizedName = (value) => String(value || '')
  .toLowerCase()
  .replace(/\b(?:signature|cocktails?)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const barItemIdentityKey = (item) => {
  const recipeKey = String(item?.cocktailRecipeKey || '').trim().toLowerCase();
  if (recipeKey) return `cocktail:${recipeKey}`;
  const beverageItemId = String(item?.beverageItemId?._id || item?.beverageItemId || '').trim().toLowerCase();
  if (beverageItemId) return `beverage:${beverageItemId}`;
  const name = normalizedName(item?.name);
  return name ? `${String(item?.scope || 'item').toLowerCase()}:${name}` : '';
};

const barItemNameKey = (item) => normalizedName(item?.name);

export const mergeManualItemsWithPackout = (existingItems, importedItems) => {
  const manualItems = (Array.isArray(existingItems) ? existingItems : [])
    .filter((item) => item?.entrySource === 'manual')
    .map((item) => typeof item?.toObject === 'function' ? item.toObject() : { ...item });
  const manualKeys = new Set(manualItems.map(barItemIdentityKey).filter(Boolean));
  const manualNameKeys = new Set(manualItems.map(barItemNameKey).filter(Boolean));
  const newPackoutItems = (Array.isArray(importedItems) ? importedItems : [])
    .filter((item) => {
      const key = barItemIdentityKey(item);
      const nameKey = barItemNameKey(item);
      return (!key || !manualKeys.has(key)) && (!nameKey || !manualNameKeys.has(nameKey));
    })
    .map((item) => ({ ...item, entrySource: 'packout' }));
  return [...manualItems, ...newPackoutItems];
};
