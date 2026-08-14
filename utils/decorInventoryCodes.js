import Product from '../models/Product.js';
import Sequence from '../models/Sequence.js';

export const DECOR_INVENTORY_CODE_PREFIX = 'OCC';
export const DECOR_INVENTORY_CODE_SEQUENCE = 'decor-inventory-code';

export const formatDecorInventoryCode = (value) => {
  const numeric = Math.max(0, Math.trunc(Number(value) || 0));
  return `${DECOR_INVENTORY_CODE_PREFIX}${String(numeric).padStart(5, '0')}`;
};

export const parseDecorInventoryCode = (value) => {
  const match = String(value || '').trim().toUpperCase().match(/^OCC(\d+)$/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
};

let sequenceFloorPromise = null;

const ensureSequenceFloor = async () => {
  if (sequenceFloorPromise) return sequenceFloorPromise;
  sequenceFloorPromise = (async () => {
    const codedProducts = await Product.find({ inventoryCode: /^OCC\d+$/i })
      .select('inventoryCode')
      .lean();
    const highestExisting = codedProducts.reduce(
      (highest, product) => Math.max(highest, parseDecorInventoryCode(product?.inventoryCode) || 0),
      0
    );
    try {
      await Sequence.findOneAndUpdate(
        { _id: DECOR_INVENTORY_CODE_SEQUENCE },
        { $max: { value: highestExisting } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
    }
  })().catch((error) => {
    sequenceFloorPromise = null;
    throw error;
  });
  return sequenceFloorPromise;
};

export const allocateDecorInventoryCodes = async (count = 1) => {
  const requested = Math.max(1, Math.min(10_000, Math.trunc(Number(count) || 1)));
  await ensureSequenceFloor();
  const sequence = await Sequence.findOneAndUpdate(
    { _id: DECOR_INVENTORY_CODE_SEQUENCE },
    { $inc: { value: requested } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const end = Number(sequence?.value || 0);
  const start = end - requested + 1;
  return Array.from({ length: requested }, (_entry, index) => formatDecorInventoryCode(start + index));
};

export const allocateDecorInventoryCode = async () => {
  const [code] = await allocateDecorInventoryCodes(1);
  return code;
};

let backfillPromise = null;
let backfillComplete = false;

export const ensureDecorInventoryCodes = async () => {
  if (backfillComplete) return 0;
  if (backfillPromise) return backfillPromise;
  backfillPromise = (async () => {
    const missing = await Product.find({
      category: { $not: /^__nexel_tape_library__(?::|$)/i },
      $or: [
        { inventoryCode: { $exists: false } },
        { inventoryCode: null },
        { inventoryCode: '' },
      ],
    })
      .sort({ createdAt: 1, _id: 1 })
      .select('_id')
      .lean();
    if (!missing.length) return 0;

    const codes = await allocateDecorInventoryCodes(missing.length);
    // Use the native collection for the one-time assignment because the schema
    // intentionally marks inventoryCode immutable after it has been set.
    const result = await Product.collection.bulkWrite(
      missing.map((product, index) => ({
        updateOne: {
          filter: {
            _id: product._id,
            $or: [
              { inventoryCode: { $exists: false } },
              { inventoryCode: null },
              { inventoryCode: '' },
            ],
          },
          update: { $set: { inventoryCode: codes[index] } },
        },
      })),
      { ordered: false }
    );
    return Number(result?.modifiedCount || 0);
  })()
    .then((modifiedCount) => {
      backfillComplete = true;
      return modifiedCount;
    })
    .finally(() => {
      backfillPromise = null;
    });
  return backfillPromise;
};
