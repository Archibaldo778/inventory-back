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
import {
  buildDecorPackoutCanvas,
  decorPackoutNeedsBoardSync,
  preserveUnplacedDecorPackoutItems,
  removeGeneratedDecorPackoutDuplicates,
  selectReusableDecorPackoutDraft,
} from '../utils/decorPackoutBoard.js';
import { requireAuth } from '../middleware/auth.js';
import { renderCatereaseOperationalDocx } from '../utils/catereaseOperations.js';
import { loadBrandLogoSvg, loadCloudinaryWordImages } from '../utils/operationalDocumentAssets.js';

const router = Router();
const MAX_PACKOUT_TYPES = 1000;
const TAPE_LIBRARY_PATTERN = /^__event_board_tape_library__(?::|$)/i;

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

const syncPackoutPage = async (packout, pageId, items) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await Page.findOne({ _id: pageId, deletedAt: null }).lean();
    if (!page) return false;
    const packoutValue = typeof packout?.toObject === 'function' ? packout.toObject() : packout;
    const next = buildDecorPackoutCanvas(page.canvas, { ...packoutValue, items });
    if (!next.changed) return true;
    const revision = Math.max(0, Number(page.revision) || 0);
    const revisionFilter = revision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision };
    const updated = await Page.findOneAndUpdate(
      { _id: page._id, deletedAt: null, ...revisionFilter },
      { $set: { canvas: next.canvas }, $inc: { revision: 1 } },
      { new: true }
    );
    if (updated) return true;
  }
  return false;
};

const syncPackoutToBoard = async (packout) => {
  const decks = await Deck.find({ eventId: packout.eventId, type: 'decor' }).select('_id').lean();
  const deckIds = decks.map((deck) => deck._id);
  const pages = deckIds.length
    ? await Page.find({ deckId: { $in: deckIds }, deletedAt: null }).select('_id').lean()
    : [];
  const fallbackPageId = String(packout.pageId || '');
  const itemsByPage = new Map();
  (packout.items || []).forEach((item) => {
    const pageId = String(item.pageId || fallbackPageId);
    if (!pageId) return;
    const entries = itemsByPage.get(pageId) || [];
    entries.push(item);
    itemsByPage.set(pageId, entries);
  });
  const pageIds = new Set([...pages.map((page) => String(page._id)), ...itemsByPage.keys()]);
  let synced = true;
  for (const pageId of pageIds) {
    if (!await syncPackoutPage(packout, pageId, itemsByPage.get(pageId) || [])) synced = false;
  }
  return synced;
};

const syncPackoutToBoardSafely = async (packout) => {
  try {
    const synced = await syncPackoutToBoard(packout);
    if (!synced) console.warn(`Decor packout ${packout?._id || ''} could not update its board after three revision conflicts`);
  } catch (error) {
    console.error('Decor packout board sync failed:', error);
  }
};

const resolvePackoutItemTarget = async (packout, requestedDeckId, requestedPageId) => {
  if (isObjectId(requestedDeckId)) {
    const { deck, page } = await resolvePackoutTarget(packout.eventId, requestedDeckId, requestedPageId);
    return { deck, page, zone: String(deck.title || '').trim() || 'Decor' };
  }
  const deck = await Deck.findOne({ _id: packout.deckId, eventId: packout.eventId, type: 'decor' });
  const page = await Page.findOne({ _id: packout.pageId, deckId: packout.deckId, deletedAt: null });
  if (deck && page) return { deck, page, zone: String(deck.title || '').trim() || 'Decor' };
  const fallback = await resolvePackoutTarget(packout.eventId);
  return { ...fallback, zone: String(fallback.deck.title || '').trim() || 'Decor' };
};

const canvasQuantity = (item) => {
  const raw = String(item?.quantityText ?? item?.quantity ?? 1).trim().replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(10000, Math.max(1, Math.floor(parsed))) : 1;
};

const canvasImageUrl = (value) => {
  const image = String(value || '').trim();
  if (!image || image.length > 2048 || /^data:/i.test(image)) return '';
  return image;
};

const packoutItemsSignature = (items = []) => JSON.stringify((Array.isArray(items) ? items : []).map((item) => ({
  id: String(item?._id || item?.id || ''),
  productId: String(item?.productId || ''),
  inventoryCode: String(item?.inventoryCode || '').trim().toUpperCase(),
  source: String(item?.source || ''),
  inventoryType: String(item?.inventoryType || ''),
  name: String(item?.name || ''),
  image: String(item?.image || ''),
  category: String(item?.category || ''),
  description: String(item?.description || ''),
  location: String(item?.location || ''),
  quantity: Number(item?.quantity || 0),
  zone: String(item?.zone || ''),
  deckId: String(item?.deckId || ''),
  pageId: String(item?.pageId || ''),
  boardItemId: String(item?.boardItemId || ''),
})));

const uniquePackoutItems = (items = [], fallbackDeckId = '') => {
  const unique = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const identity = String(item?.productId || '').trim()
      || String(item?.inventoryCode || '').trim().toUpperCase()
      || String(item?.name || '').trim().toLowerCase();
    if (!identity) return;
    const scope = String(item?.deckId || fallbackDeckId || item?.zone || '').trim();
    const key = `${scope}:${identity}`;
    const existing = unique.get(key);
    if (!existing || Number(item?.quantity || 0) > Number(existing?.quantity || 0)) unique.set(key, item);
  });
  return [...unique.values()];
};

const isCanvasPackoutItem = (item, packoutId) => {
  if (!item || ['text', 'link', 'table', 'staff'].includes(String(item.type || '').toLowerCase())) return false;
  if (String(item.boardItemType || '').toLowerCase() === 'staff') return false;
  const linkedPackoutId = String(item.decorPackoutId || '');
  if (linkedPackoutId) return linkedPackoutId === String(packoutId || '');
  return Boolean(
    isObjectId(item.productId)
    || parseDecorInventoryCode(String(item.inventoryCode || '').trim().toUpperCase())
  );
};

const mergePackoutItemsFromEventBoards = async (packout) => {
  const previousItemsSignature = packoutItemsSignature(packout.items);
  const decks = await Deck.find({ eventId: packout.eventId, type: 'decor' }).sort({ createdAt: 1 }).lean();
  const deckIds = decks.map((deck) => deck._id);
  const pages = deckIds.length
    ? await Page.find({ deckId: { $in: deckIds }, deletedAt: null }).sort({ deckId: 1, index: 1, createdAt: 1 }).lean()
    : [];
  const candidates = [];
  const canvasPackoutItemIds = new Set();
  const duplicateCleanupTasks = [];
  pages.forEach((page) => {
    const deck = decks.find((entry) => String(entry._id) === String(page.deckId));
    const zone = String(deck?.title || '').trim() || 'Decor';
    const originalImages = Array.isArray(page?.canvas?.images) ? page.canvas.images : [];
    const images = removeGeneratedDecorPackoutDuplicates(originalImages, packout._id);
    if (images.length !== originalImages.length) {
      const revision = Math.max(0, Number(page.revision) || 0);
      const revisionFilter = revision === 0
        ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
        : { revision };
      duplicateCleanupTasks.push(Page.updateOne(
        { _id: page._id, deletedAt: null, ...revisionFilter },
        { $set: { 'canvas.images': images }, $inc: { revision: 1 } }
      ).catch((error) => {
        console.error('Decor packout duplicate cleanup failed:', error);
        return null;
      }));
    }
    images.forEach((item) => {
      if (
        String(item?.decorPackoutId || '') === String(packout._id)
        && String(item?.decorPackoutItemId || '').trim()
      ) canvasPackoutItemIds.add(String(item.decorPackoutItemId).trim());
      if (isCanvasPackoutItem(item, packout._id)) candidates.push({ item, deck, page, zone });
    });
  });
  await Promise.all(duplicateCleanupTasks);

  const productIds = [...new Set(candidates.map(({ item }) => String(item.productId || '')).filter(isObjectId))];
  const inventoryCodes = [...new Set(candidates
    .map(({ item }) => String(item.inventoryCode || '').trim().toUpperCase())
    .filter((code) => parseDecorInventoryCode(code)))];
  const productQuery = [];
  if (productIds.length) productQuery.push({ _id: { $in: productIds } });
  if (inventoryCodes.length) productQuery.push({ inventoryCode: { $in: inventoryCodes } });
  const products = productQuery.length ? await Product.find({ $or: productQuery }).lean() : [];
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const productByCode = new Map(products.map((product) => [String(product.inventoryCode || '').toUpperCase(), product]));
  const grouped = new Map();

  candidates.forEach(({ item, deck, page, zone }) => {
    const code = String(item.inventoryCode || '').trim().toUpperCase();
    const product = productById.get(String(item.productId || '')) || productByCode.get(code) || null;
    if (product && TAPE_LIBRARY_PATTERN.test(String(product.category || ''))) return;
    const productId = String(product?._id || item.productId || '');
    const inventoryCode = String(product?.inventoryCode || code).trim().toUpperCase();
    const name = String(product?.name || item.name || item.initialName || '').trim();
    if (!name) return;
    const deckId = String(deck?._id || packout.deckId || '');
    const identity = productId || inventoryCode || name.toLowerCase();
    const key = `${deckId}:${identity}`;
    const current = grouped.get(key);
    if (current) {
      current.quantity = Math.min(10000, current.quantity + canvasQuantity(item));
      return;
    }
    grouped.set(key, {
      product,
      productId,
      inventoryCode,
      name,
      image: canvasImageUrl(product?.image || product?.imageUrl || product?.images?.[0] || item.src),
      category: String(product?.category || item.category || '').trim(),
      description: String(item.description || product?.description || '').trim(),
      location: String(product?.location || '').trim(),
      quantity: canvasQuantity(item),
      zone,
      deckId: deck?._id || packout.deckId,
      pageId: page?._id || packout.pageId,
      boardItemId: String(item.id || '').trim(),
    });
  });

  const reconciledItems = [];
  const matchedItemIds = new Set();
  grouped.forEach((value) => {
    const existing = (packout.items || []).find((item) => {
      const itemDeckId = String(item.deckId || packout.deckId || '');
      if (itemDeckId !== String(value.deckId || '')) return false;
      if (value.productId && String(item.productId || '') === value.productId) return true;
      if (value.inventoryCode && String(item.inventoryCode || '').toUpperCase() === value.inventoryCode) return true;
      return !value.productId && !value.inventoryCode && String(item.name || '').trim().toLowerCase() === value.name.toLowerCase();
    });
    if (existing) {
      matchedItemIds.add(String(existing._id || existing.id || ''));
      existing.productId = isObjectId(value.productId) ? value.productId : null;
      existing.inventoryCode = parseDecorInventoryCode(value.inventoryCode) ? value.inventoryCode : '';
      existing.source = value.product ? 'inventory' : existing.source;
      existing.inventoryType = value.product?.inventoryType === 'disposable' ? 'disposable' : (existing.inventoryType || 'decor');
      existing.name = value.name;
      existing.image = value.image || existing.image;
      existing.category = value.category || existing.category;
      existing.description = value.description || existing.description;
      existing.location = value.location || existing.location;
      existing.quantity = value.quantity;
      existing.zone = value.zone;
      existing.deckId = value.deckId;
      existing.pageId = value.pageId;
      existing.boardItemId = value.boardItemId;
      existing.updatedAt = new Date();
      reconciledItems.push(existing);
      return;
    }
    if (reconciledItems.length >= MAX_PACKOUT_TYPES) {
      throw Object.assign(new Error(`Packout is limited to ${MAX_PACKOUT_TYPES} item types`), { statusCode: 413 });
    }
    reconciledItems.push({
      productId: isObjectId(value.productId) ? value.productId : null,
      inventoryCode: parseDecorInventoryCode(value.inventoryCode) ? value.inventoryCode : '',
      source: value.product ? 'inventory' : 'event',
      inventoryType: value.product?.inventoryType === 'disposable' ? 'disposable' : 'decor',
      name: value.name,
      image: value.image,
      category: value.category,
      description: value.description,
      location: value.location,
      quantity: value.quantity,
      zone: value.zone,
      deckId: value.deckId,
      pageId: value.pageId,
      boardItemId: value.boardItemId,
    });
  });
  packout.items = preserveUnplacedDecorPackoutItems(packout.items, reconciledItems, matchedItemIds);
  if (packoutItemsSignature(packout.items) !== previousItemsSignature) {
    await packout.save();
    clearCaches();
  }
  if (decorPackoutNeedsBoardSync(packout.items, canvasPackoutItemIds)) {
    await syncPackoutToBoardSafely(packout);
  }
  return packout;
};

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
    const items = await DecorPackout.find(query).sort({ updatedAt: -1, createdAt: -1 }).limit(200);
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
    const existingDrafts = await DecorPackout.find({
      eventId: event._id,
      deckId: deck._id,
      status: 'draft',
    }).sort({ updatedAt: -1, createdAt: -1 });
    const existing = selectReusableDecorPackoutDraft(existingDrafts);
    if (existing) {
      existing.eventTitle = event.title || existing.eventTitle || '';
      existing.eventDate = event.date || existing.eventDate || '';
      existing.eventClient = event.client || existing.eventClient || '';
      if (!existing.pageId) existing.pageId = page._id;
      await existing.save();
      clearCaches();
      return res.json(existing);
    }
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

router.post('/:id/sync-board', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (packout.status !== 'draft') return res.status(409).json({ error: 'Reopen this packout before syncing the Decor Board' });
    const synced = await mergePackoutItemsFromEventBoards(packout);
    return res.json(synced);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor Board packout sync failed',
      fallbackMessage: 'Failed to sync Decor Board items into the packout',
    });
  }
});

router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (!packout.items?.length) return res.status(409).json({ error: 'This packout has no items' });
    const event = await Event.findById(packout.eventId).select('externalId title date client managerId meta').lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const exportItems = uniquePackoutItems(packout.items, packout.deckId);
    const rows = exportItems.map((item) => ({
      itemName: item.name,
      quantity: item.quantity,
      menuGroup: item.zone || item.category || 'DECOR',
      notes: [item.inventoryCode, item.location, item.description].filter(Boolean).join(' · '),
    }));
    const [brandLogoSvg, decorImages] = await Promise.all([
      loadBrandLogoSvg(),
      loadCloudinaryWordImages(exportItems.map((item) => ({ itemName: item.name, url: item.image }))),
    ]);
    const docx = await renderCatereaseOperationalDocx({
      event: { ...event, salesRep: event.managerId || '' },
      snapshot: { schemaVersion: 3, eventId: event.externalId || '', packOut: rows },
      type: 'po',
      brandLogoSvg,
      decorImages,
      includePackOutTemplate: false,
    });
    const safeTitle = String(event.title || packout.eventTitle || 'Event')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Event';
    const dateMatch = String(event.date || packout.eventDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const datePrefix = dateMatch ? `${dateMatch[2]}-${dateMatch[3]}-${dateMatch[1].slice(-2)}` : '';
    const fileName = [datePrefix, safeTitle, 'Decor PO'].filter(Boolean).join(' ');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.docx"`);
    return res.send(docx);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout export failed',
      fallbackMessage: 'Failed to generate decor packout document',
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
    const quantity = req.body?.quantity === undefined ? 1 : Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return res.status(400).json({ error: 'Quantity must be a whole number from 1 to 10000' });
    }
    const product = await Product.findOne({ inventoryCode });
    if (!product || TAPE_LIBRARY_PATTERN.test(String(product.category || ''))) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const target = await resolvePackoutItemTarget(packout, req.body?.deckId, req.body?.pageId);
    const existing = packout.items.find((item) => (
      String(item.productId) === String(product._id)
      && String(item.deckId || packout.deckId) === String(target.deck._id)
    ));
    if (existing) {
      existing.quantity = Math.min(10000, Number(existing.quantity || 0) + quantity);
      existing.zone = target.zone;
      existing.deckId = target.deck._id;
      existing.pageId = target.page._id;
      existing.updatedAt = new Date();
      existing.scannedBy = actorName(req.auth);
    } else {
      if (packout.items.length >= MAX_PACKOUT_TYPES) {
        return res.status(413).json({ error: `Packout is limited to ${MAX_PACKOUT_TYPES} item types` });
      }
      packout.items.push({
        productId: product._id,
        inventoryCode: product.inventoryCode,
        source: 'inventory',
        inventoryType: product.inventoryType === 'disposable' ? 'disposable' : 'decor',
        name: product.name,
        image: product.image || product.imageUrl || product.images?.[0] || '',
        category: product.category || '',
        location: product.location || '',
        quantity,
        zone: target.zone,
        deckId: target.deck._id,
        pageId: target.page._id,
        scannedBy: actorName(req.auth),
      });
    }
    await packout.save();
    await syncPackoutToBoardSafely(packout);
    clearCaches();
    return res.json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor packout scan failed',
      fallbackMessage: 'Failed to add scanned inventory item',
    });
  }
});

router.post('/:id/items', async (req, res) => {
  try {
    const packout = await loadPackout(req.params.id);
    if (!packout) return res.status(404).json({ error: 'Packout not found' });
    if (packout.status !== 'draft') return res.status(409).json({ error: 'This packout is complete' });

    const name = String(req.body?.name || '').trim();
    const quantity = Number(req.body?.quantity ?? 1);
    const image = String(req.body?.image || '').trim();
    const category = String(req.body?.category || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!name || name.length > 160) return res.status(400).json({ error: 'Item name is required and must be 160 characters or fewer' });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return res.status(400).json({ error: 'Quantity must be a whole number from 1 to 10000' });
    }
    if (image.length > 2048) return res.status(400).json({ error: 'Item image URL is too long' });
    if (category.length > 120) return res.status(400).json({ error: 'Category must be 120 characters or fewer' });
    if (description.length > 1000) return res.status(400).json({ error: 'Description must be 1000 characters or fewer' });
    if (packout.items.length >= MAX_PACKOUT_TYPES) {
      return res.status(413).json({ error: `Packout is limited to ${MAX_PACKOUT_TYPES} item types` });
    }

    const target = await resolvePackoutItemTarget(packout, req.body?.deckId, req.body?.pageId);
    packout.items.push({
      productId: null,
      inventoryCode: '',
      source: 'event',
      name,
      image,
      category: category || 'Disposable / event purchase',
      description,
      quantity,
      zone: target.zone,
      deckId: target.deck._id,
      pageId: target.page._id,
      scannedBy: actorName(req.auth),
    });
    await packout.save();
    await syncPackoutToBoardSafely(packout);
    clearCaches();
    return res.status(201).json(packout);
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Decor event item creation failed',
      fallbackMessage: 'Failed to add event-only decor item',
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
    await syncPackoutToBoardSafely(packout);
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
    await syncPackoutToBoardSafely(packout);
    if (!packout.items.length) {
      await DecorPackout.deleteOne({ _id: packout._id });
      clearCaches();
      return res.json({ deleted: true, id: String(packout._id), items: [] });
    }
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
