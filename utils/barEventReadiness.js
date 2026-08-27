import { getPreparedBeverageType } from './barPackoutScope.js';

export const summarizeBarEventReadiness = (event = {}) => {
  const items = (Array.isArray(event?.items) ? event.items : []).filter((item) => item?.included !== false);
  const unmatchedAlcohol = items.filter((item) => (
    String(item?.scope || '') === 'alcohol' && !item?.beverageItemId
  )).length;
  const missingRecipes = items.filter((item) => (
    getPreparedBeverageType(item) && !String(item?.cocktailRecipeKey || '').trim()
  )).length;

  return {
    eventId: String(event?._id || event?.id || ''),
    linkedEventId: String(event?.linkedEventId?._id || event?.linkedEventId || ''),
    unmatchedAlcohol,
    missingRecipes,
    total: unmatchedAlcohol + missingRecipes,
  };
};
