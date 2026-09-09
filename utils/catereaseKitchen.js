const clean = (value) => String(value ?? '').trim();
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const booleanValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'y', 'on'].includes(clean(value).toLowerCase());
};
const dateOrNull = (value) => {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const catereaseSourceKey = (locationId, sourceId) => `${clean(locationId)}:${clean(sourceId)}`;

export const buildCatereaseKitchenCatalog = ({ menuItems = [], menuItemRecipes = [], ingredients = [], ingredientRecipes = [] } = {}) => {
  const ingredientByKey = new Map();
  (Array.isArray(ingredients) ? ingredients : []).forEach((row) => {
    const locationId = clean(row.LocNum) || 'default';
    const sourceId = clean(row.IRNum || row.IngID);
    if (sourceId) ingredientByKey.set(catereaseSourceKey(locationId, sourceId), row);
  });
  const ingredientLinks = new Map();
  (Array.isArray(ingredientRecipes) ? ingredientRecipes : []).forEach((row) => {
    const parentId = clean(row.LinkedIRNum);
    const componentId = clean(row.IRNum || row.IngID);
    if (!parentId || !componentId) return;
    const key = catereaseSourceKey(clean(row.LocNum) || 'default', parentId);
    const rows = ingredientLinks.get(key) || [];
    rows.push(row);
    ingredientLinks.set(key, rows);
  });
  const recipeLinks = new Map();
  (Array.isArray(menuItemRecipes) ? menuItemRecipes : []).forEach((row) => {
    const itemId = clean(row.ItemNum);
    const ingredientId = clean(row.IRNum || row.IngID);
    if (!itemId || !ingredientId) return;
    const key = catereaseSourceKey(clean(row.LocNum) || 'default', itemId);
    const rows = recipeLinks.get(key) || [];
    rows.push(row);
    recipeLinks.set(key, rows);
  });
  const component = (row) => {
    const locationId = clean(row.LocNum) || 'default';
    const sourceId = clean(row.IRNum || row.IngID);
    const master = ingredientByKey.get(catereaseSourceKey(locationId, sourceId));
    return {
      sourceId,
      name: clean(row.ItemName || master?.ItemName || master?.Title),
      quantity: numberOrNull(row.Qty),
      unit: clean(row.Unit),
      unitId: clean(row.UnitNum),
      recipeServings: numberOrNull(row.RServings),
      reportedCost: numberOrNull(row.Cost),
      purchaseUnitCost: numberOrNull(row.PUnitCost ?? master?.PUnitCost),
      subRecipe: booleanValue(row.SubRecipe ?? master?.SubRecipe),
      instructions: clean(row.Instructions || master?.Instructions),
    };
  };
  const normalizedIngredients = [...ingredientByKey.entries()].map(([key, row]) => {
    const locationId = clean(row.LocNum) || 'default';
    const sourceId = clean(row.IRNum || row.IngID);
    return {
      key,
      sourceId,
      locationId,
      name: clean(row.ItemName || row.Title || row.IngID),
      category: clean(row.Category),
      type: clean(row.Type),
      instructions: clean(row.Instructions),
      notes: clean(row.Notes || row.Comment),
      prepArea: clean(row.PrepArea),
      purchaseUnit: clean(row.PUnitNum),
      purchaseUnitQuantity: numberOrNull(row.PUnitQty),
      purchaseUnitCost: numberOrNull(row.PUnitCost),
      defaultUnit: clean(row.Unit || row.DUnitNum),
      vendor: clean(row.Vendor),
      vendorId: clean(row.VendorNum),
      scalable: booleanValue(row.Scalable),
      subRecipe: booleanValue(row.SubRecipe),
      components: (ingredientLinks.get(key) || []).map(component),
      revisedAt: dateOrNull(row.Revised),
    };
  }).filter((row) => row.name);
  const normalizedRecipes = (Array.isArray(menuItems) ? menuItems : []).map((row) => {
    const sourceId = clean(row.ItemNum || row.ItemID || row.ID);
    const locationId = clean(row.LocNum) || 'default';
    const cost = numberOrNull(row.Cost);
    const servings = numberOrNull(row.Servings);
    return {
      key: catereaseSourceKey(locationId, sourceId),
      sourceId,
      locationId,
      menuId: clean(row.MenuNum),
      name: clean(row.ItemName || row.Title || row.LongTitle || row.ItemID),
      title: clean(row.LongTitle || row.Title),
      category: clean(row.Category),
      itemType: clean(row.ItemType),
      description: clean(row.Description || row.Comment),
      instructions: clean(row.Instructions || row.Prepare),
      notes: clean(row.Notes),
      prepArea: clean(row.PrepArea),
      servings,
      price: numberOrNull(row.Price),
      cost,
      costPerServing: cost !== null && servings && servings > 0 ? cost / servings : null,
      ingredients: (recipeLinks.get(catereaseSourceKey(locationId, sourceId)) || []).map(component),
      hidden: booleanValue(row.Hide),
      inactive: booleanValue(row.Inactive),
      hasPicture: booleanValue(row.HasPicture),
      revisedAt: dateOrNull(row.Revised),
    };
  }).filter((row) => row.sourceId && row.name);
  return { ingredients: normalizedIngredients, recipes: normalizedRecipes };
};

const unwrapInclude = (bundle, key) => {
  const include = bundle?.includes?.[key];
  if (!include || include?._status === 'error') return null;
  return include?.data ?? include;
};

export const buildCatereaseFinancialPreview = (bundle = {}) => {
  const financials = unwrapInclude(bundle, 'financials') || {};
  const lineItems = unwrapInclude(bundle, 'lineItems');
  const rows = Array.isArray(lineItems) ? lineItems : [];
  const categoryTotals = new Map();
  rows.forEach((row) => {
    const category = clean(row.category || row.type || 'Uncategorized');
    const current = categoryTotals.get(category) || { category, items: 0, quantity: 0, lineTotal: 0 };
    current.items += 1;
    current.quantity += numberOrNull(row.quantity) || 0;
    current.lineTotal += numberOrNull(row.lineTotal) || 0;
    categoryTotals.set(category, current);
  });
  return {
    event: bundle?.event || null,
    financials,
    lineItems: rows.slice(0, 2000),
    categoryTotals: [...categoryTotals.values()].sort((left, right) => right.lineTotal - left.lineTotal),
    warnings: Object.entries(bundle?.includes || {})
      .filter(([, value]) => value?._status === 'error')
      .map(([key, value]) => ({ resource: key, message: clean(value?._error?.message || 'Caterease resource failed') })),
  };
};
