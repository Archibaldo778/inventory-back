import mongoose from 'mongoose';

const beverageInventoryMovementSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['initial', 'receive', 'return', 'usage', 'waste', 'adjustment'],
    required: true,
  },
  quantityDelta: { type: Number, required: true },
  note: { type: String, default: '', trim: true },
  actorUserId: { type: String, default: '', trim: true },
  actorName: { type: String, default: '', trim: true },
  unitCostSnapshot: { type: Number, default: 0, min: 0 },
  sourceEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  at: { type: Date, default: Date.now },
}, { _id: true });

const BeverageItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true },
  category: { type: String, default: '', trim: true },
  subCategory: { type: String, default: '', trim: true },
  categories: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  aliases: { type: [String], default: [] },
  isAlcohol: { type: Boolean, default: false },
  sku: { type: String, default: '', trim: true, index: true },
  barcode: { type: String, default: '', trim: true },
  supplier: { type: String, default: '', trim: true, select: false },
  storageLocation: { type: String, default: '', trim: true },
  unitType: {
    type: String,
    enum: ['bottle', 'can', 'keg', 'case', 'unit'],
    default: 'bottle',
  },
  purchaseCost: { type: Number, default: 0, min: 0, select: false },
  bottleSizeMl: { type: Number, default: null, min: 0 },
  caseCost: { type: Number, default: null, min: 0, select: false },
  caseSize: { type: Number, default: null, min: 1 },
  stockOnHand: { type: Number, default: 0, min: 0, select: false },
  reorderLevel: { type: Number, default: 0, min: 0, select: false },
  lastInventoryAt: { type: Date, default: null, select: false },
  inventoryMovements: {
    type: [beverageInventoryMovementSchema],
    default: [],
    select: false,
  },
  active: { type: Boolean, default: true, index: true },
  image: { type: String, default: null },
}, { timestamps: true });

BeverageItemSchema.index({ active: 1, category: 1, name: 1 });

export default mongoose.model('BeverageItem', BeverageItemSchema);
