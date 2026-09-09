import mongoose from 'mongoose';

const recipeIngredientSchema = new mongoose.Schema({
  ingredientSourceId: { type: String, trim: true, required: true },
  name: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: null },
  unit: { type: String, trim: true, default: '' },
  unitId: { type: String, trim: true, default: '' },
  recipeServings: { type: Number, default: null },
  reportedCost: { type: Number, default: null },
  purchaseUnitCost: { type: Number, default: null },
  subRecipe: { type: Boolean, default: false },
  instructions: { type: String, trim: true, default: '' },
}, { _id: false });

const kitchenRecipeSchema = new mongoose.Schema({
  sourceProvider: { type: String, default: 'caterease', immutable: true, index: true },
  sourceId: { type: String, required: true, trim: true },
  locationId: { type: String, required: true, trim: true },
  menuId: { type: String, trim: true, default: '' },
  name: { type: String, required: true, trim: true },
  title: { type: String, trim: true, default: '' },
  category: { type: String, trim: true, default: '' },
  itemType: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  instructions: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  prepArea: { type: String, trim: true, default: '' },
  servings: { type: Number, default: null },
  price: { type: Number, default: null },
  cost: { type: Number, default: null },
  costPerServing: { type: Number, default: null },
  ingredients: { type: [recipeIngredientSchema], default: [] },
  hidden: { type: Boolean, default: false },
  inactive: { type: Boolean, default: false },
  hasPicture: { type: Boolean, default: false },
  revisedAt: { type: Date, default: null },
  sourceDeletedAt: { type: Date, default: null },
  lastSeenRun: { type: String, trim: true, default: '', index: true },
}, { timestamps: true });

kitchenRecipeSchema.index({ sourceProvider: 1, locationId: 1, sourceId: 1 }, { unique: true });
kitchenRecipeSchema.index({ name: 1, locationId: 1 });

export default mongoose.model('KitchenRecipe', kitchenRecipeSchema);
