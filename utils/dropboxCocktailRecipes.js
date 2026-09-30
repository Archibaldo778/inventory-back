const clean = (value) => String(value || '').trim();
const normalize = (value) => clean(value).toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\b(?:signature|cocktails?|mocktails?)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const keyFor = (value) => normalize(value).replace(/\s+/g, '-').slice(0, 80);

const amountMl = (amount, unit) => {
  const number = Number(amount);
  if (!Number.isFinite(number) || number < 0) return null;
  if (/oz/i.test(unit)) return Math.round(number * 29.5735 * 10) / 10;
  if (/cl/i.test(unit)) return Math.round(number * 10 * 10) / 10;
  return number;
};

export const parseDropboxRecipeDetails = (notes) => {
  const source = clean(notes).replace(/^Kitchen Menu (?:ingredients|recipe):\s*/i, '');
  const parts = source.split(/\s*[|;,]\s*/).map(clean).filter(Boolean);
  const ingredients = [];
  const instructions = [];
  parts.forEach((part) => {
    if (/^(?:garnish|glass|serve|shake|stir|strain|build|batch|top|pour|note)\b/i.test(part)) {
      instructions.push(part);
      return;
    }
    const leading = part.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(oz|ml|cl)\s+(.+)$/i);
    const trailing = part.match(/^(.+?)\s+(\d+(?:\.\d+)?|\.\d+)\s*(oz|ml|cl)$/i);
    const match = leading || trailing;
    if (match) {
      const name = clean(leading ? match[3] : match[1]);
      const amount = leading ? match[1] : match[2];
      const unit = leading ? match[2] : match[3];
      if (name) ingredients.push({ name, amountMl: amountMl(amount, unit), note: '' });
      return;
    }
    if (part && !/^ingredients?\b/i.test(part)) ingredients.push({ name: part, amountMl: null, note: '' });
  });
  return { ingredients, instructions: instructions.join('. ') };
};

export const buildDropboxRecipeCandidates = (documents = []) => {
  const candidates = [];
  const seen = new Set();
  (Array.isArray(documents) ? documents : []).forEach((document) => {
    if (clean(document?.type || document?.documentType) !== 'kitchen_menu') return;
    (Array.isArray(document?.barItems) ? document.barItems : []).forEach((item) => {
      const type = clean(item?.preparedBeverageType).toLowerCase();
      const name = clean(item?.name);
      if (!['cocktail', 'mocktail'].includes(type) || !name) return;
      const details = parseDropboxRecipeDetails(item?.notes);
      if (details.ingredients.length < 2) return;
      const signature = `${type}:${normalize(name)}:${details.ingredients.map((row) => normalize(row.name)).sort().join('|')}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      candidates.push({
        key: keyFor(name), type, name, aliases: [],
        ingredients: details.ingredients,
        instructions: details.instructions,
        sourceDropboxId: clean(document?.sourceId || document?.dropboxId),
        sourceRevision: clean(document?.sourceRevision || document?.rev),
      });
    });
  });
  return candidates;
};

const ingredientSet = (recipe) => new Set((recipe?.ingredients || []).map((row) => normalize(row?.name)).filter(Boolean));
const ingredientSimilarity = (left, right) => {
  const a = ingredientSet(left);
  const b = ingredientSet(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((name) => b.has(name)).length;
  return overlap / Math.max(a.size, b.size);
};

export const planDropboxRecipeSync = (candidates = [], existingRecipes = []) => {
  const knownRecipes = [...existingRecipes];
  return candidates.map((candidate) => {
  const exact = knownRecipes.find((recipe) => [recipe?.name, ...(recipe?.aliases || [])]
    .some((name) => normalize(name) === normalize(candidate.name)));
  const composition = exact || knownRecipes
    .map((recipe) => ({ recipe, score: recipe?.type === candidate.type ? ingredientSimilarity(recipe, candidate) : 0 }))
    .filter(({ score }) => score >= 0.8)
    .sort((left, right) => right.score - left.score)[0]?.recipe;
  if (!composition) {
    Object.defineProperty(candidate, '__plannedCreate', { value: true });
    knownRecipes.push(candidate);
    return { action: 'create', candidate };
  }
  const aliases = [...new Set([
    ...(composition.aliases || []),
    ...(normalize(composition.name) === normalize(candidate.name) ? [] : [candidate.name]),
  ].map(clean).filter(Boolean))];
  if (composition.__plannedCreate) {
    composition.aliases = aliases;
    composition.ingredients = candidate.ingredients;
    if (candidate.instructions) composition.instructions = candidate.instructions;
    return { action: 'skip', candidate };
  }
  const planned = {
    action: 'update', recipe: composition,
    updates: {
      aliases,
      ingredients: candidate.ingredients,
      ...(candidate.instructions ? { instructions: candidate.instructions } : {}),
    },
    candidate,
  };
  Object.assign(composition, planned.updates);
  return planned;
  });
};

export const syncDropboxCocktailRecipes = async ({ documents = [], RecipeModel }) => {
  const candidates = buildDropboxRecipeCandidates(documents);
  if (!candidates.length) return { candidates: 0, created: 0, updated: 0 };
  const existing = await RecipeModel.find({ active: { $ne: false } }).lean();
  const plan = planDropboxRecipeSync(candidates, existing);
  const operations = plan.filter((entry) => entry.action !== 'skip').map((entry) => entry.action === 'create' ? {
    updateOne: {
      filter: { key: entry.candidate.key },
      update: { $setOnInsert: { ...entry.candidate, active: true } },
      upsert: true,
    },
  } : {
    updateOne: { filter: { _id: entry.recipe._id }, update: { $set: entry.updates } },
  });
  await RecipeModel.bulkWrite(operations, { ordered: false });
  return {
    candidates: candidates.length,
    created: plan.filter((entry) => entry.action === 'create').length,
    updated: plan.filter((entry) => entry.action === 'update').length,
  };
};
