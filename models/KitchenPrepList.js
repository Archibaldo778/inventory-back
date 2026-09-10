import mongoose from 'mongoose';

const prepIngredientSchema = new mongoose.Schema({
  sourceKey: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  unit: { type: String, trim: true, default: '' },
  baseQuantity: { type: Number, default: null },
  baseServings: { type: Number, default: 1, min: 0.000001 },
  overrideQuantity: { type: Number, default: null, min: 0 },
}, { _id: false });

const prepDishSchema = new mongoose.Schema({
  kitchenItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'KitchenItem', default: null },
  recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'KitchenRecipe', default: null },
  name: { type: String, required: true, trim: true },
  recipeName: { type: String, trim: true, default: '' },
  image: { type: String, trim: true, default: '' },
  section: { type: String, trim: true, default: '' },
  recipeServings: { type: Number, default: 1, min: 0.000001 },
  ingredients: { type: [prepIngredientSchema], default: [] },
}, { timestamps: false });

const kitchenPrepListSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  title: { type: String, required: true, trim: true, default: 'Kitchen Prep' },
  eventName: { type: String, trim: true, default: '' },
  eventDate: { type: String, trim: true, default: '' },
  guestCount: { type: Number, default: 0, min: 0 },
  productionPercent: { type: Number, default: 100, min: 0, max: 1000 },
  dishes: { type: [prepDishSchema], default: [] },
  createdBy: { type: String, trim: true, default: '' },
  updatedBy: { type: String, trim: true, default: '' },
}, { timestamps: true });

kitchenPrepListSchema.index(
  { eventId: 1 },
  { unique: true, partialFilterExpression: { eventId: { $type: 'objectId' } } }
);

export default mongoose.model('KitchenPrepList', kitchenPrepListSchema);
