import mongoose from 'mongoose';

const cocktailIngredientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  amountMl: { type: Number, default: null, min: 0 },
  note: { type: String, default: '', trim: true },
}, { _id: false });

const CocktailRecipeSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  aliases: { type: [String], default: [] },
  ingredients: { type: [cocktailIngredientSchema], default: [] },
  instructions: { type: String, default: '', trim: true },
  image: { type: String, default: null },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

CocktailRecipeSchema.index({ active: 1, name: 1 });

export default mongoose.model('CocktailRecipe', CocktailRecipeSchema);
