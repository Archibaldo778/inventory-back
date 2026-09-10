const text = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const positive = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const rounded = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

export const kitchenPrepIngredientKey = (ingredient = {}, index = 0) => (
  text(ingredient.ingredientSourceId || ingredient.sourceKey)
  || `${text(ingredient.name).toLowerCase()}|${text(ingredient.unit).toLowerCase()}|${index}`
);

export const buildKitchenPrepDish = ({ kitchenItem = null, recipe = null, name = '', section = '' } = {}) => {
  const sourceRecipe = recipe?.toObject ? recipe.toObject() : (recipe || {});
  const sourceItem = kitchenItem?.toObject ? kitchenItem.toObject() : (kitchenItem || {});
  const recipeServings = positive(sourceRecipe.servings, 1);
  const ingredients = (Array.isArray(sourceRecipe.ingredients) ? sourceRecipe.ingredients : []).map((ingredient, index) => ({
    sourceKey: kitchenPrepIngredientKey(ingredient, index),
    name: text(ingredient.name) || `Ingredient ${index + 1}`,
    unit: text(ingredient.unit),
    baseQuantity: numberOrNull(ingredient.quantity),
    baseServings: positive(ingredient.recipeServings, recipeServings),
    overrideQuantity: null,
  }));
  return {
    kitchenItemId: sourceItem._id || null,
    recipeId: sourceRecipe._id || null,
    name: text(name || sourceItem.name || sourceRecipe.name) || 'Untitled dish',
    recipeName: text(sourceRecipe.name),
    image: text(sourceItem.image),
    section: text(section),
    recipeServings,
    ingredients,
  };
};

export const calculateKitchenPrepList = (prepList = {}) => {
  const guestCount = Math.max(0, Number(prepList.guestCount) || 0);
  const productionPercent = Math.max(0, Number(prepList.productionPercent) || 0);
  const portions = rounded(guestCount * productionPercent / 100);
  const totals = new Map();
  const dishes = (Array.isArray(prepList.dishes) ? prepList.dishes : []).map((dish) => ({
    ...(dish?.toObject ? dish.toObject() : dish),
    portions,
    ingredients: (Array.isArray(dish?.ingredients) ? dish.ingredients : []).map((ingredient) => {
      const raw = ingredient?.toObject ? ingredient.toObject() : ingredient;
      const baseQuantity = numberOrNull(raw.baseQuantity);
      const calculatedQuantity = baseQuantity === null
        ? null
        : rounded(baseQuantity * portions / positive(raw.baseServings, positive(dish.recipeServings, 1)));
      const overrideQuantity = numberOrNull(raw.overrideQuantity);
      const finalQuantity = overrideQuantity === null ? calculatedQuantity : Math.max(0, overrideQuantity);
      const aggregateKey = `${text(raw.name).toLowerCase()}|${text(raw.unit).toLowerCase()}`;
      if (finalQuantity !== null && text(raw.name)) {
        const current = totals.get(aggregateKey) || { name: text(raw.name), unit: text(raw.unit), quantity: 0, overridden: false };
        current.quantity = rounded(current.quantity + finalQuantity);
        current.overridden = current.overridden || overrideQuantity !== null;
        totals.set(aggregateKey, current);
      }
      return { ...raw, calculatedQuantity, finalQuantity, overridden: overrideQuantity !== null };
    }),
  }));
  return {
    ...(prepList?.toObject ? prepList.toObject() : prepList),
    portions,
    dishes,
    ingredientTotals: [...totals.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
};
