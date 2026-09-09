import mongoose from 'mongoose';

const componentSchema = new mongoose.Schema({
  sourceId: { type: String, trim: true, required: true },
  name: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: null },
  unit: { type: String, trim: true, default: '' },
  unitId: { type: String, trim: true, default: '' },
  reportedCost: { type: Number, default: null },
  purchaseUnitCost: { type: Number, default: null },
  instructions: { type: String, trim: true, default: '' },
}, { _id: false });

const kitchenIngredientSchema = new mongoose.Schema({
  sourceProvider: { type: String, default: 'caterease', immutable: true, index: true },
  sourceId: { type: String, required: true, trim: true },
  locationId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true, default: '' },
  type: { type: String, trim: true, default: '' },
  instructions: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  prepArea: { type: String, trim: true, default: '' },
  purchaseUnit: { type: String, trim: true, default: '' },
  purchaseUnitQuantity: { type: Number, default: null },
  purchaseUnitCost: { type: Number, default: null },
  defaultUnit: { type: String, trim: true, default: '' },
  vendor: { type: String, trim: true, default: '' },
  vendorId: { type: String, trim: true, default: '' },
  scalable: { type: Boolean, default: false },
  subRecipe: { type: Boolean, default: false },
  components: { type: [componentSchema], default: [] },
  revisedAt: { type: Date, default: null },
  sourceDeletedAt: { type: Date, default: null },
  lastSeenRun: { type: String, trim: true, default: '', index: true },
}, { timestamps: true });

kitchenIngredientSchema.index({ sourceProvider: 1, locationId: 1, sourceId: 1 }, { unique: true });

export default mongoose.model('KitchenIngredient', kitchenIngredientSchema);

