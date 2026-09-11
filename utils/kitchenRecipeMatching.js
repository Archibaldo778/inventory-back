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

const DIETARY_SUFFIXES = new Set([
  'alc', 'alcohol', 'df', 'gf', 'nf', 'v', 'vegan', 'vegetarian', 'vg',
]);

export const canonicalKitchenRecipeName = (value) => {
  const withoutPricing = cleanText(value)
    .replace(/(?:\s|,)*(?:\+|\$)\s*\d+(?:\.\d+)?\s*$/g, '')
    .trim();
  const tokens = normalizeKitchenRecipeName(withoutPricing).split(' ').filter(Boolean);
  while (tokens.length && DIETARY_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens
    .filter((token, index) => index === 0 || token !== tokens[index - 1])
    .join(' ');
};

const recipeTimestamp = (recipe) => {
  const value = new Date(recipe?.revisedAt || recipe?.updatedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

export const buildExactRecipeMatchIndex = (recipes = []) => {
  const grouped = new Map();
  recipes.forEach((recipe) => {
    const normalizedName = canonicalKitchenRecipeName(recipe?.name);
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

    const recipe = candidates.slice().sort((left, right) => {
      const ingredientDifference = Number(right?.ingredients?.length || 0) - Number(left?.ingredients?.length || 0);
      return ingredientDifference || recipeTimestamp(right) - recipeTimestamp(left);
    })[0];
    index.set(normalizedName, { status: 'matched', recipe, candidateCount: candidates.length });
  });
  return index;
};

export const resolveExactRecipeMatch = (name, index) => {
  const normalizedName = canonicalKitchenRecipeName(name);
  if (!normalizedName) return { status: 'unmatched', normalizedName };
  const match = index?.get?.(normalizedName);
  return match ? { ...match, normalizedName } : { status: 'unmatched', normalizedName };
};

export const kitchenRecipeNameSimilarity = (left, right) => {
  const leftTokens = new Set(canonicalKitchenRecipeName(left).split(' ').filter(Boolean));
  const rightTokens = new Set(canonicalKitchenRecipeName(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) shared += 1; });
  return shared / Math.max(leftTokens.size, rightTokens.size);
};

export const findKitchenRecipeCandidates = (name, recipes = [], limit = 12) => {
  const queryName = canonicalKitchenRecipeName(name);
  if (!queryName) return [];
  const bestByName = new Map();
  recipes.forEach((recipe) => {
    if (recipe?.sourceDeletedAt || recipe?.inactive || recipe?.hidden) return;
    const canonicalName = canonicalKitchenRecipeName(recipe?.name);
    if (!canonicalName) return;
    const score = kitchenRecipeNameSimilarity(queryName, canonicalName);
    if (score <= 0) return;
    const current = bestByName.get(canonicalName);
    const candidate = {
      recipe,
      score,
      exact: canonicalName === queryName,
      canonicalName,
    };
    if (!current) {
      bestByName.set(canonicalName, candidate);
      return;
    }
    const currentIngredients = Number(current.recipe?.ingredients?.length || 0);
    const nextIngredients = Number(recipe?.ingredients?.length || 0);
    if (nextIngredients > currentIngredients || (
      nextIngredients === currentIngredients && recipeTimestamp(recipe) > recipeTimestamp(current.recipe)
    )) bestByName.set(canonicalName, candidate);
  });
  return [...bestByName.values()]
    .sort((left, right) => (
      Number(right.exact) - Number(left.exact)
      || right.score - left.score
      || Number(right.recipe?.ingredients?.length || 0) - Number(left.recipe?.ingredients?.length || 0)
      || recipeTimestamp(right.recipe) - recipeTimestamp(left.recipe)
    ))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 12)));
};

export const syncKitchenRecipeMatches = async () => {
  const [recipes, kitchenItems] = await Promise.all([
    KitchenRecipe.find({ sourceProvider: 'caterease', sourceDeletedAt: null })
      .select('_id sourceId locationId name ingredients inactive hidden revisedAt updatedAt')
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
      const nextMethod = normalizeKitchenRecipeName(item?.name) === normalizeKitchenRecipeName(match.recipe?.name)
        ? 'auto_exact'
        : 'auto_canonical';
      const alreadyMatched = String(item?.catereaseRecipeId || '') === String(match.recipe._id)
        && item?.recipeMatchMethod === nextMethod
        && item?.recipeMatchName === match.normalizedName;
      if (alreadyMatched) return;
      summary.changed += 1;
      operations.push({
        updateOne: {
          filter: { _id: item._id, recipeMatchMethod: { $ne: 'manual' } },
          update: { $set: {
            catereaseRecipeId: match.recipe._id,
            recipeMatchMethod: nextMethod,
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
