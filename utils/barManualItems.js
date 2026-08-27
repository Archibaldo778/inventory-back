import { getPreparedBeverageType } from './barPackoutScope.js';

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

export const mergePackoutDocumentItems = (existingItems, importedItems, documentTypes = []) => {
  const types = new Set((Array.isArray(documentTypes) ? documentTypes : [])
    .map((value) => String(value || '').toLowerCase()));
  if (!types.size || (types.has('po') && types.has('kitchen_menu'))) {
    return mergeManualItemsWithPackout(existingItems, importedItems);
  }
  const preservePrepared = types.has('po');
  const source = Array.isArray(existingItems) ? existingItems : [];
  const manualItems = source
    .filter((item) => item?.entrySource === 'manual')
    .map((item) => typeof item?.toObject === 'function' ? item.toObject() : { ...item });
  const manualKeys = new Set(manualItems.map(barItemIdentityKey).filter(Boolean));
  const manualNames = new Set(manualItems.map(barItemNameKey).filter(Boolean));
  const retained = source
    .filter((item) => item?.entrySource !== 'manual' && Boolean(getPreparedBeverageType(item)) === preservePrepared)
    .map((item) => typeof item?.toObject === 'function' ? item.toObject() : { ...item });
  const incoming = (Array.isArray(importedItems) ? importedItems : [])
    .filter((item) => {
      const key = barItemIdentityKey(item);
      const name = barItemNameKey(item);
      return (!key || !manualKeys.has(key)) && (!name || !manualNames.has(name));
    })
    .map((item) => ({ ...item, entrySource: 'packout' }));
  const incomingKeys = new Set(incoming.map(barItemIdentityKey).filter(Boolean));
  const incomingNames = new Set(incoming.map(barItemNameKey).filter(Boolean));
  const preserved = retained.filter((item) => {
    const key = barItemIdentityKey(item);
    const name = barItemNameKey(item);
    return (!key || !incomingKeys.has(key)) && (!name || !incomingNames.has(name));
  });
  return [...manualItems, ...preserved, ...incoming];
};

export const schedulePreparedItemsForEvent = (items, eventDate, { at = new Date(), by = '' } = {}) => {
  const scheduledDate = String(eventDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return items;
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!getPreparedBeverageType(item) || String(item?.prepTask?.scheduledDate || '').trim()) return;
    if (!item.prepTask) item.prepTask = {};
    item.prepTask.scheduledDate = scheduledDate;
    item.prepTask.scheduledAt = at;
    item.prepTask.scheduledBy = String(by || '');
    item.prepTask.completedAt = null;
    item.prepTask.completedBy = '';
  });
  return items;
};
