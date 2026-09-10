import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import KitchenItem from '../models/KitchenItem.js';
import KitchenPrepList from '../models/KitchenPrepList.js';
import { sendApiError } from '../utils/apiErrors.js';
import { normalizeKitchenRecipeName } from '../utils/kitchenRecipeMatching.js';
import { buildKitchenPrepDish, calculateKitchenPrepList } from '../utils/kitchenPrep.js';

const router = Router();
const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const actor = (req) => clean(req.auth?.username || req.auth?.email, 180);
const numberInRange = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const eventGuestCount = (event) => numberInRange(
  event?.meta?.guestCount ?? event?.meta?.guest_count ?? event?.meta?.guests,
  0,
  100000,
  0
);
const populateRecipe = (query) => query.populate('catereaseRecipeId');

const eventMenuRows = (event) => (Array.isArray(event?.documents) ? event.documents : [])
  .filter((document) => document?.type === 'kitchen_menu')
  .flatMap((document) => Array.isArray(document?.kitchenItems) ? document.kitchenItems : [])
  .filter((row) => clean(row?.name));

const dishesFromKitchenItems = (items, sourceRows = []) => {
  const byName = new Map();
  items.forEach((item) => {
    const key = normalizeKitchenRecipeName(item?.name);
    if (key && !byName.has(key)) byName.set(key, item);
  });
  const seen = new Set();
  return sourceRows.map((row) => {
    const key = normalizeKitchenRecipeName(row?.normalizedName || row?.name);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const item = byName.get(key) || null;
    return buildKitchenPrepDish({
      kitchenItem: item,
      recipe: item?.catereaseRecipeId || null,
      name: row?.name,
      section: row?.section,
    });
  }).filter(Boolean);
};

const loadEventDishes = async (event) => {
  const rows = eventMenuRows(event);
  if (!rows.length) return [];
  const items = await populateRecipe(KitchenItem.find()).lean();
  return dishesFromKitchenItems(items, rows);
};

router.get('/', async (req, res) => {
  try {
    const query = validId(req.query.eventId) ? { eventId: req.query.eventId } : {};
    const items = await KitchenPrepList.find(query)
      .select('-dishes.ingredients')
      .sort({ eventDate: -1, updatedAt: -1 })
      .limit(500)
      .lean();
    return res.json({ items });
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep list failed', fallbackMessage: 'Failed to list kitchen prep sheets' });
  }
});

router.get('/event/:eventId', async (req, res) => {
  try {
    if (!validId(req.params.eventId)) return res.status(400).json({ error: 'Invalid event ID' });
    const [event, prepList] = await Promise.all([
      Event.findById(req.params.eventId).lean(),
      KitchenPrepList.findOne({ eventId: req.params.eventId }).lean(),
    ]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json({ event, prepList: prepList ? calculateKitchenPrepList(prepList) : null });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event kitchen prep failed', fallbackMessage: 'Failed to load event prep sheet' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid prep sheet ID' });
    const item = await KitchenPrepList.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep lookup failed', fallbackMessage: 'Failed to load kitchen prep sheet' });
  }
});

router.post('/', async (req, res) => {
  try {
    const eventId = validId(req.body?.eventId) ? req.body.eventId : null;
    if (eventId) {
      const existing = await KitchenPrepList.findOne({ eventId }).lean();
      if (existing) return res.json(calculateKitchenPrepList(existing));
    }
    const event = eventId ? await Event.findById(eventId) : null;
    if (eventId && !event) return res.status(404).json({ error: 'Event not found' });
    const importEventMenu = req.body?.importEventMenu !== false;
    const item = await KitchenPrepList.create({
      eventId,
      title: clean(req.body?.title) || (event ? `${event.title} · Kitchen Prep` : 'Kitchen Prep'),
      eventName: clean(event?.title || req.body?.eventName),
      eventDate: clean(event?.date || req.body?.eventDate, 40),
      guestCount: numberInRange(req.body?.guestCount, 0, 100000, eventGuestCount(event)),
      productionPercent: numberInRange(req.body?.productionPercent, 0, 1000, 100),
      dishes: event && importEventMenu ? await loadEventDishes(event) : [],
      createdBy: actor(req),
      updatedBy: actor(req),
    });
    return res.status(201).json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep creation failed', fallbackMessage: 'Failed to create kitchen prep sheet' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const item = await KitchenPrepList.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    if (req.body?.title !== undefined) item.title = clean(req.body.title) || item.title;
    if (req.body?.guestCount !== undefined) item.guestCount = numberInRange(req.body.guestCount, 0, 100000, item.guestCount);
    if (req.body?.productionPercent !== undefined) item.productionPercent = numberInRange(req.body.productionPercent, 0, 1000, item.productionPercent);
    if (req.body?.eventName !== undefined && !item.eventId) item.eventName = clean(req.body.eventName);
    if (req.body?.eventDate !== undefined && !item.eventId) item.eventDate = clean(req.body.eventDate, 40);
    item.updatedBy = actor(req);
    await item.save();
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep update failed', fallbackMessage: 'Failed to update kitchen prep sheet' });
  }
});

router.post('/:id/import-event-menu', async (req, res) => {
  try {
    const item = await KitchenPrepList.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    if (!item.eventId) return res.status(400).json({ error: 'This prep sheet is not linked to an event' });
    const event = await Event.findById(item.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const imported = await loadEventDishes(event);
    const existing = new Set(item.dishes.map((dish) => normalizeKitchenRecipeName(dish.name)));
    imported.forEach((dish) => { if (!existing.has(normalizeKitchenRecipeName(dish.name))) item.dishes.push(dish); });
    item.updatedBy = actor(req);
    await item.save();
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen Menu prep import failed', fallbackMessage: 'Failed to import Kitchen Menu dishes' });
  }
});

router.post('/:id/dishes', async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.kitchenItemIds) ? req.body.kitchenItemIds : []).map(String).filter(validId))].slice(0, 500);
    if (!ids.length) return res.status(400).json({ error: 'Choose at least one dish' });
    const [item, kitchenItems] = await Promise.all([
      KitchenPrepList.findById(req.params.id),
      populateRecipe(KitchenItem.find({ _id: { $in: ids } })).lean(),
    ]);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    const existing = new Set(item.dishes.map((dish) => String(dish.kitchenItemId || '')));
    kitchenItems.forEach((kitchenItem) => {
      if (!existing.has(String(kitchenItem._id))) item.dishes.push(buildKitchenPrepDish({ kitchenItem, recipe: kitchenItem.catereaseRecipeId }));
    });
    item.updatedBy = actor(req);
    await item.save();
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep dish add failed', fallbackMessage: 'Failed to add dishes' });
  }
});

router.delete('/:id/dishes/:dishId', async (req, res) => {
  try {
    const item = await KitchenPrepList.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    const dish = item.dishes.id(req.params.dishId);
    if (!dish) return res.status(404).json({ error: 'Prep dish not found' });
    dish.deleteOne();
    item.updatedBy = actor(req);
    await item.save();
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep dish removal failed', fallbackMessage: 'Failed to remove dish' });
  }
});

router.patch('/:id/dishes/:dishId/ingredients/:sourceKey', async (req, res) => {
  try {
    const item = await KitchenPrepList.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    const dish = item.dishes.id(req.params.dishId);
    if (!dish) return res.status(404).json({ error: 'Prep dish not found' });
    const ingredient = dish.ingredients.find((row) => row.sourceKey === req.params.sourceKey);
    if (!ingredient) return res.status(404).json({ error: 'Prep ingredient not found' });
    ingredient.overrideQuantity = req.body?.overrideQuantity === null || req.body?.overrideQuantity === ''
      ? null
      : numberInRange(req.body?.overrideQuantity, 0, 100000000, ingredient.overrideQuantity);
    item.updatedBy = actor(req);
    await item.save();
    return res.json(calculateKitchenPrepList(item));
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep ingredient update failed', fallbackMessage: 'Failed to update ingredient quantity' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await KitchenPrepList.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Kitchen prep sheet not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Kitchen prep deletion failed', fallbackMessage: 'Failed to delete kitchen prep sheet' });
  }
});

export default router;
