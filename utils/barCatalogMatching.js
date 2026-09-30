import { normalizeOcrCatalogName } from './barPackoutRecognition.js';

export const collectBarCatalogMatchTargets = (events, names, beverageItemId) => {
  const catalogId = String(beverageItemId || '').trim();
  const aliasKeys = new Set((Array.isArray(names) ? names : [])
    .map(normalizeOcrCatalogName)
    .filter(Boolean));
  if (!catalogId || !aliasKeys.size) return [];

  return (Array.isArray(events) ? events : []).map((event) => {
    const itemIds = (Array.isArray(event?.items) ? event.items : [])
      .filter((item) => (
        aliasKeys.has(normalizeOcrCatalogName(item?.name))
        && String(item?.beverageItemId || '') !== catalogId
      ))
      .map((item) => String(item?._id || item?.id || '').trim())
      .filter(Boolean);
    return itemIds.length ? {
      eventId: String(event?._id || event?.id || '').trim(),
      itemIds,
    } : null;
  }).filter((entry) => entry?.eventId);
};
