import mongoose from 'mongoose';

const kitchenIngredientUnitSchema = new mongoose.Schema({
  sourceProvider: { type: String, default: 'caterease', immutable: true, index: true },
  locationId: { type: String, required: true, trim: true },
  ingredientSourceId: { type: String, trim: true, default: '' },
  unitId: { type: String, required: true, trim: true },
  name: { type: String, trim: true, default: '' },
  convertFrom: { type: String, trim: true, default: '' },
  convertTo: { type: String, trim: true, default: '' },
  conversionUnitId: { type: String, trim: true, default: '' },
  conversionRatio: { type: Number, default: null },
  baseConversionRatio: { type: Number, default: null },
  note: { type: String, trim: true, default: '' },
  sourceDeletedAt: { type: Date, default: null },
  lastSeenRun: { type: String, trim: true, default: '', index: true },
}, { timestamps: true });

kitchenIngredientUnitSchema.index(
  { sourceProvider: 1, locationId: 1, ingredientSourceId: 1, unitId: 1 },
  { unique: true }
);

export default mongoose.model('KitchenIngredientUnit', kitchenIngredientUnitSchema);
