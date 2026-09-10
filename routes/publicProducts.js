import { Router } from 'express';
import Product from '../models/Product.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import { parseDecorInventoryCode } from '../utils/decorInventoryCodes.js';
import { normalizeProductImages } from '../utils/productImages.js';

const router = Router();
const publicProductRateLimit = createMemoryRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  message: 'Too many product lookups. Try again shortly.',
});

// Deliberately exposes only customer-safe catalog details. Warehouse stock,
// locations, supplier information and Mongo identifiers stay private.
router.get('/code/:inventoryCode', publicProductRateLimit, async (req, res) => {
  try {
    const inventoryCode = String(req.params.inventoryCode || '').trim().toUpperCase();
    if (!parseDecorInventoryCode(inventoryCode)) {
      return res.status(400).json({ error: 'Invalid inventory code' });
    }

    const item = await Product.findOne({ inventoryCode }).lean();
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    const images = normalizeProductImages(item);
    return res.json({
      inventoryCode: item.inventoryCode,
      inventoryType: item.inventoryType || 'decor',
      name: item.name || '',
      description: item.description || '',
      category: item.category || '',
      material: item.material || '',
      color: item.color || '',
      sizes: Array.isArray(item.sizes) ? item.sizes : [],
      sizeOptions: Array.isArray(item.sizeOptions) ? item.sizeOptions : [],
      selectedSize: item.selectedSize || '',
      sizeLabel: item.sizeLabel || '',
      sizeWidth: item.sizeWidth || '',
      sizeHeight: item.sizeHeight || '',
      sizeDepth: item.sizeDepth || '',
      image: images[0] || '',
      images,
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Public product lookup failed',
      fallbackMessage: 'Failed to load inventory item',
    });
  }
});

export default router;
