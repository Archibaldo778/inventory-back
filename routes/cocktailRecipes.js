import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import CocktailRecipe from '../models/CocktailRecipe.js';
import { DEFAULT_COCKTAIL_RECIPES } from '../utils/defaultCocktailRecipes.js';
import { cleanupManagedImageSafely } from '../utils/managedImageCleanup.js';
import { INVALID_IMAGE_UPLOAD_RESPONSE, isAllowedImageUpload } from '../utils/imageSignature.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20, parts: 21 },
  fileFilter: (_req, file, callback) => {
    const source = `${file?.mimetype || ''} ${file?.originalname || ''}`.toLowerCase();
    return /(?:jpe?g|png|webp|heic|heif)/.test(source)
      ? callback(null, true)
      : callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  },
});

const clean = (value, length = 500) => String(value ?? '').trim().slice(0, length);
const parseBoolean = (value, fallback = true) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const cleanIngredients = (value) => parseArray(value).slice(0, 50).map((ingredient) => ({
  name: clean(ingredient?.name, 120),
  amountMl: ingredient?.amountMl === null || ingredient?.amountMl === '' ? null : Number(ingredient?.amountMl),
  note: clean(ingredient?.note, 240),
})).filter((ingredient) => ingredient.name && (ingredient.amountMl === null || (Number.isFinite(ingredient.amountMl) && ingredient.amountMl >= 0)));
const cleanAliases = (value) => parseArray(value).slice(0, 50).map((alias) => clean(alias, 160)).filter(Boolean);
const cleanKey = (value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cleanRecipeType = (value) => String(value || '').trim().toLowerCase() === 'mocktail' ? 'mocktail' : 'cocktail';

let defaultsEnsured = false;
const ensureDefaults = async () => {
  if (defaultsEnsured) return;
  const operations = DEFAULT_COCKTAIL_RECIPES.flatMap((recipe) => [
    {
      updateOne: {
        filter: { key: recipe.key },
        update: { $setOnInsert: recipe },
        upsert: true,
      },
    },
    ...(recipe.instructions ? [{
      updateOne: {
        filter: { key: recipe.key, $or: [{ instructions: '' }, { instructions: null }, { instructions: { $exists: false } }] },
        update: { $set: { instructions: recipe.instructions } },
      },
    }] : []),
  ]);
  await CocktailRecipe.bulkWrite(operations, { ordered: false });
  defaultsEnsured = true;
};
const localUpload = async (file) => {
  const directory = path.join(__dirname, '..', 'uploads', 'cocktails');
  await fs.promises.mkdir(directory, { recursive: true });
  const rawExtension = path.extname(String(file.originalname || '')).toLowerCase();
  const extension = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(rawExtension) ? rawExtension : '.jpg';
  const filename = `cocktail-${Date.now()}-${crypto.randomUUID()}${extension}`;
  await fs.promises.writeFile(path.join(directory, filename), file.buffer);
  return `/uploads/cocktails/${filename}`;
};
const cloudUpload = (file) => new Promise((resolve, reject) => {
  const options = { folder: process.env.CLOUDINARY_COCKTAIL_FOLDER || 'cocktails', resource_type: 'image' };
  if (/heic|heif/i.test(`${file?.mimetype} ${file?.originalname}`)) options.format = 'jpg';
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => error ? reject(error) : resolve(result?.secure_url || result?.url || ''));
  Readable.from(file.buffer).pipe(stream);
});
const saveImage = async (file) => {
  try { return await cloudUpload(file); }
  catch (error) {
    if (process.env.NODE_ENV === 'production' && String(process.env.BEVERAGE_UPLOAD_FALLBACK || '').toLowerCase() !== 'local') throw error;
    return localUpload(file);
  }
};

router.get('/', async (req, res) => {
  try {
    await ensureDefaults();
    const query = req.query.includeInactive === '1' ? {} : { active: { $ne: false } };
    return res.json(await CocktailRecipe.find(query).sort({ name: 1 }));
  } catch (error) { return sendApiError(res, error, { context: 'Cocktail recipes list failed', fallbackMessage: 'Failed to load cocktail recipes' }); }
});

router.post('/', upload.single('image'), async (req, res) => {
  let image = '';
  try {
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    const name = clean(req.body?.name, 160);
    const key = cleanKey(req.body?.key || name);
    const ingredients = cleanIngredients(req.body?.ingredients);
    if (!name || !key || !ingredients.length) return res.status(400).json({ message: 'Name and ingredients are required' });
    if (req.file) image = await saveImage(req.file);
    const recipe = await CocktailRecipe.create({ key, type: cleanRecipeType(req.body?.type), name, aliases: cleanAliases(req.body?.aliases), ingredients, instructions: clean(req.body?.instructions, 2000), active: parseBoolean(req.body?.active), image: image || null });
    return res.status(201).json(recipe);
  } catch (error) {
    if (image) await cleanupManagedImageSafely(image, 'orphaned cocktail image');
    if (error?.code === 11000) return res.status(409).json({ message: 'A cocktail with this name/key already exists' });
    return sendApiError(res, error, { context: 'Cocktail recipe creation failed', fallbackMessage: 'Failed to create cocktail recipe' });
  }
});

router.patch('/:id', upload.single('image'), async (req, res) => {
  let image = '';
  try {
    const current = await CocktailRecipe.findById(req.params.id);
    if (!current) return res.status(404).json({ message: 'Cocktail recipe not found' });
    if (req.file && !isAllowedImageUpload(req.file, ['jpeg', 'png', 'webp', 'heif'])) return res.status(400).json(INVALID_IMAGE_UPLOAD_RESPONSE);
    const updates = {};
    if (req.body?.key !== undefined) updates.key = cleanKey(req.body.key);
    if (req.body?.type !== undefined) updates.type = cleanRecipeType(req.body.type);
    if (req.body?.name !== undefined) updates.name = clean(req.body.name, 160);
    if (req.body?.aliases !== undefined) updates.aliases = cleanAliases(req.body.aliases);
    if (req.body?.ingredients !== undefined) updates.ingredients = cleanIngredients(req.body.ingredients);
    if (req.body?.instructions !== undefined) updates.instructions = clean(req.body.instructions, 2000);
    if (req.body?.active !== undefined) updates.active = parseBoolean(req.body.active, current.active);
    if (req.file) { image = await saveImage(req.file); updates.image = image; }
    else if (parseBoolean(req.body?.removeImage, false)) updates.image = null;
    if (!String(updates.name ?? current.name).trim() || !(updates.ingredients ?? current.ingredients).length) return res.status(400).json({ message: 'Name and ingredients are required' });
    const updated = await CocktailRecipe.findByIdAndUpdate(current._id, updates, { new: true, runValidators: true });
    if (Object.prototype.hasOwnProperty.call(updates, 'image') && current.image && current.image !== updates.image) await cleanupManagedImageSafely(current.image, 'cocktail image');
    return res.json(updated);
  } catch (error) {
    if (image) await cleanupManagedImageSafely(image, 'orphaned cocktail image');
    if (error?.code === 11000) return res.status(409).json({ message: 'A cocktail with this name/key already exists' });
    return sendApiError(res, error, { context: 'Cocktail recipe update failed', fallbackMessage: 'Failed to update cocktail recipe' });
  }
});

export default router;
