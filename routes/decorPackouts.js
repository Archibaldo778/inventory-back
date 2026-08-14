import mongoose from 'mongoose';
import { Router } from 'express';
import Deck from '../models/Deck.js';
import DecorPackout from '../models/DecorPackout.js';
import Event from '../models/Event.js';
import Page from '../models/Page.js';
import Product from '../models/Product.js';
import { clearApiCacheGroups } from '../utils/apiCache.js';
import { parseDecorInventoryCode } from '../utils/decorInventoryCodes.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const MAX_PACKOUT_TYPES = 1000;
const TAPE_LIBRARY_PATTERN = /^__nexel_tape_library__(?::|$)/i;

const actorName = (auth) => String(auth?.username || auth?.email || '').trim();
const isObjectId = (value) => mongoose.isValidObjectId(String(value || '').trim());
const clearCaches = () => clearApiCacheGroups('decor-packouts', 'decks', 'pages');

const blankCanvas = () => ({
  images: [],
  shapes: [],
  backgroundColor: '#ffffff',
  meta: { pageOrientation: 'landscape', tldrawDocument: null },
});

const resolvePackoutTarget = async (eventId, requestedDeckId, requestedPageId) => {
  let deck = null;
  if (isObjectId(requestedDeckId)) {
    deck = await Deck.findOne({ _id: requestedDeckId, eventId, type: 'decor' });
    if (!deck) {
      throw Object.assign(new Error('Selected Decor deck was not found for this event'), { statusCode: 400 });
    }
  } else {
    deck = await Deck.findOne({ eventId, type: 'decor' }).sort({ createdAt: 1 });
    if (!deck) deck = await Deck.create({ eventId, type: 'decor', title: 'Decor' });
  }

  let page = null;
  if (isObjectId(requestedPageId)) {
    page = await Page.findOne({ _id: requestedPageId, deckId: deck._id });
    if (!page) {
      throw Object.assign(new Error('Selected Decor page was not found in this deck'), { statusCode: 400 });
    }
  } else {
    page = await Page.findOne({ deckId: deck._id }).sort({ index: 1, createdAt: 1 });
    if (!page) page = await Page.create({ deckId: deck._id, index: 0, canvas: blankCanvas(), preview: '' });
  }

  return { deck, page };
};

const loadPackout = (id) => (
  isObjectId(id) ? DecorPackout.findById(id) : null
);

router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.eventId) {
      if (!isObjectId(req.query.eventId)) return res.status(400).json({ error: 'Invalid event id' });
      query.eventId = req.query.eventId;
    }
    if (req.query.deckId) {
      if (!isObjectId(req.query.deckId)) return res.status(400).json({ error: 'Invalid deck id' });
      query.deckId = req.query.deckId;
    }
    if (req.query.status && ['draft', 'complete'].includes(String(req.query.status))) {
      query.status = String(req.query.status);
    }
    const items = await DecorPackout.find(query).sort({ createdAt: -1 }).limit(200);
    return res.json(items);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout list failed',
      fallbackMessage: 'Failed to list decor packouts',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const eventId = String(req.body?.eventId || '').trim();
    if (!isObjectId(eventId)) return res.status(400).json({ error: 'Valid eventId is required' });
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { deck, page } = await resolvePackoutTarget(event._id, req.body?.deckId, req.body?.pageId);
    const packout = await DecorPackout.create({
      eventId: event._id,
      deckId: deck._id,
      pageId: page._id,
      eventTitle: event.title || '',
      eventDate: event.date || '',
      eventClient: event.client || '',
      createdByUserId: String(req.auth?.userId || ''),
      createdBy: actorName(req.auth),
    });
    clearCaches();
    return res.status(201).json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout creation failed',
      fallbackMessage: 'Failed to create decor packout',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout lookup failed',
      fallbackMessage: 'Failed to load decor packout',
    });
  }
});

router.post('/:id/scan', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (packout.status !== 'draft') return res.status(409).json({ error: 'This packout is complete' });

    const inventoryCode = String(req.body?.inventoryCode || '').trim().toUpperCase();
    if (!parseDecorInventoryCode(inventoryCode)) {
      return res.status(400).json({ error: 'Scan a valid OCC inventory QR code' });
    }
    const product = await Product.findOne({ inventoryCode });
    if (!product || TAPE_LIBRARY_PATTERN.test(String(product.category || ''))) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const existing = packout.items.find((item) => String(item.productId) === String(product._id));
    if (existing) {
      existing.quantity = Math.min(10000, Number(existing.quantity || 0) + 1);
      existing.updatedAt = new Date();
      existing.scannedBy = actorName(req.auth);
    } else {
      if (packout.items.length >= MAX_PACKOUT_TYPES) {
        return res.status(413).json({ error: `Packout is limited to ${MAX_PACKOUT_TYPES} item types` });
      }
      packout.items.push({
        productId: product._id,
        inventoryCode: product.inventoryCode,
        name: product.name,
        image: product.image || product.imageUrl || '',
        category: product.category || '',
        location: product.location || '',
        quantity: 1,
        scannedBy: actorName(req.auth),
      });
    }
    await packout.save();
    clearCaches();
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout scan failed',
      fallbackMessage: 'Failed to add scanned inventory item',
    });
  }
});

router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (packout.status !== 'draft') return res.status(409).json({ error: 'This packout is complete' });
    const item = packout.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Packout item not found' });
    const quantity = Number(req.body?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return res.status(400).json({ error: 'Quantity must be a whole number from 1 to 10000' });
    }
    item.quantity = quantity;
    item.updatedAt = new Date();
    await packout.save();
    clearCaches();
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout item update failed',
      fallbackMessage: 'Failed to update packout item',
    });
  }
});

router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (packout.status !== 'draft') return res.status(409).json({ error: 'This packout is complete' });
    const item = packout.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Packout item not found' });
    item.deleteOne();
    await packout.save();
    clearCaches();
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout item deletion failed',
      fallbackMessage: 'Failed to remove packout item',
    });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['draft', 'complete'].includes(status)) return res.status(400).json({ error: 'Invalid packout status' });
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    packout.status = status;
    packout.completedAt = status === 'complete' ? new Date() : null;
    packout.completedBy = status === 'complete' ? actorName(req.auth) : '';
    await packout.save();
    clearCaches();
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout status update failed',
      fallbackMessage: 'Failed to update packout status',
    });
  }
});

export default router;
