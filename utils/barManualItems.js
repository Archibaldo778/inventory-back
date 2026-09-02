import { getPreparedBeverageType } from './barPackoutScope.js';

const normalizedName = (value) => {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:signature|cocktails?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\bott\b/.test(normalized) && /\brose\b/.test(normalized) && (/\bby ott\b/.test(normalized) || /\bcotes? de provence\b/.test(normalized))) {
    return 'domaines ott by ott rose';
  }
  return normalized;
};

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

const operationalStateScore = (item) => (
  (item?.returnConfirmed === true ? 100 : 0)
  + (item?.prepTask?.completedAt ? 50 : 0)
  + (item?.prepTask?.scheduledDate ? 20 : 0)
  + (item?.deliveredQty !== null && item?.deliveredQty !== undefined ? 10 : 0)
  + (item?.updatedAt ? 1 : 0)
);

export const preservePackoutOperationalState = (existingItems, nextItems) => {
  const existing = (Array.isArray(existingItems) ? existingItems : [])
    .map((item) => typeof item?.toObject === 'function' ? item.toObject() : { ...item });
  return (Array.isArray(nextItems) ? nextItems : []).map((item) => {
    const identity = barItemIdentityKey(item);
    const name = barItemNameKey(item);
    const match = existing
      .filter((candidate) => (
        (identity && barItemIdentityKey(candidate) === identity)
        || (name && barItemNameKey(candidate) === name)
      ))
      .sort((left, right) => operationalStateScore(right) - operationalStateScore(left))[0];
    if (!match) return item;
    const next = {
      ...item,
      deliveredQty: match.deliveredQty ?? item.deliveredQty ?? null,
      returnedFullQty: Number(match.returnedFullQty ?? item.returnedFullQty ?? 0),
      returnedOpenQty: Number(match.returnedOpenQty ?? item.returnedOpenQty ?? 0),
      lostDamagedQty: Number(match.lostDamagedQty ?? item.lostDamagedQty ?? 0),
      returnConfirmed: match.returnConfirmed === true || item.returnConfirmed === true,
      captainNotes: String(match.captainNotes || item.captainNotes || ''),
      prepTask: match.prepTask || item.prepTask,
      updatedBy: String(match.updatedBy || item.updatedBy || ''),
      updatedAt: match.updatedAt || item.updatedAt || null,
    };
    if (match._id) next._id = match._id;
    return next;
  });
};

export const schedulePreparedItemsForEvent = (items, eventDate, { at = new Date(), by = '' } = {}) => {
  const scheduledDate = String(eventDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return items;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const shouldPack = item?.included !== false
      && String(item?.scope || '').toLowerCase() !== 'non_bar';
    if (!shouldPack || String(item?.prepTask?.scheduledDate || '').trim()) return;
    if (!item.prepTask) item.prepTask = {};
    item.prepTask.scheduledDate = scheduledDate;
    item.prepTask.scheduledAt = at;
    item.prepTask.scheduledBy = String(by || '');
    item.prepTask.completedAt = null;
    item.prepTask.completedBy = '';
  });
  return items;
};
