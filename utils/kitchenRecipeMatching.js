const cleanText = (value) => String(value ?? '').trim();

export const normalizeKitchenRecipeName = (value) => cleanText(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const recipeTimestamp = (recipe) => {
  const value = new Date(recipe?.revisedAt || recipe?.updatedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

export const buildExactRecipeMatchIndex = (recipes = []) => {
  const grouped = new Map();
  recipes.forEach((recipe) => {
    const normalizedName = normalizeKitchenRecipeName(recipe?.name);
    if (!normalizedName) return;
    const entries = grouped.get(normalizedName) || [];
    entries.push(recipe);
    grouped.set(normalizedName, entries);
  });

  const index = new Map();
  grouped.forEach((entries, normalizedName) => {
    const activeEntries = entries.filter((recipe) => !recipe?.inactive && !recipe?.hidden && !recipe?.sourceDeletedAt);
    const candidates = activeEntries.length ? activeEntries : entries.filter((recipe) => !recipe?.sourceDeletedAt);
    if (!candidates.length) return;

    const recipe = candidates.slice().sort((left, right) => recipeTimestamp(right) - recipeTimestamp(left))[0];
    index.set(normalizedName, { status: 'matched', recipe, candidateCount: candidates.length });
  });
  return index;
};

export const resolveExactRecipeMatch = (name, index) => {
  const normalizedName = normalizeKitchenRecipeName(name);
  if (!normalizedName) return { status: 'unmatched', normalizedName };
  const match = index?.get?.(normalizedName);
  return match ? { ...match, normalizedName } : { status: 'unmatched', normalizedName };
};

export const syncKitchenRecipeMatches = async () => {
  const [recipes, kitchenItems] = await Promise.all([
    KitchenRecipe.find({ sourceProvider: 'caterease', sourceDeletedAt: null })
      .select('_id sourceId locationId name inactive hidden revisedAt updatedAt')
      .lean(),
    KitchenItem.find().select('_id name catereaseRecipeId recipeMatchMethod recipeMatchName').lean(),
  ]);
  const index = buildExactRecipeMatchIndex(recipes);
  const operations = [];
  const summary = { matched: 0, unmatched: 0, preservedManual: 0, changed: 0 };

  kitchenItems.forEach((item) => {
    if (item?.recipeMatchMethod === 'manual' && item?.catereaseRecipeId) {
      summary.preservedManual += 1;
      return;
    }
    const match = resolveExactRecipeMatch(item?.name, index);
    if (match.status === 'matched' && match.recipe?._id) {
      summary.matched += 1;
      const alreadyMatched = String(item?.catereaseRecipeId || '') === String(match.recipe._id)
        && item?.recipeMatchMethod === 'auto_exact'
        && item?.recipeMatchName === match.normalizedName;
      if (alreadyMatched) return;
      summary.changed += 1;
      operations.push({
        updateOne: {
          filter: { _id: item._id, recipeMatchMethod: { $ne: 'manual' } },
          update: { $set: {
            catereaseRecipeId: match.recipe._id,
            recipeMatchMethod: 'auto_exact',
            recipeMatchName: match.normalizedName,
            recipeMatchedAt: new Date(),
          } },
        },
      });
      return;
    }

    summary.unmatched += 1;
    if (!item?.catereaseRecipeId && !item?.recipeMatchMethod && !item?.recipeMatchName) return;
    summary.changed += 1;
    operations.push({
      updateOne: {
        filter: { _id: item._id, recipeMatchMethod: { $ne: 'manual' } },
        update: {
          $set: { recipeMatchMethod: '', recipeMatchName: '', recipeMatchedAt: null },
          $unset: { catereaseRecipeId: 1 },
        },
      },
    });
  });

  if (operations.length) await KitchenItem.bulkWrite(operations, { ordered: false });
  return summary;
};
import KitchenItem from '../models/KitchenItem.js';
import KitchenRecipe from '../models/KitchenRecipe.js';
