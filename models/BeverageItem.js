import mongoose from 'mongoose';

const BeverageItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  category: { type: String, default: '', trim: true },
  subCategory: { type: String, default: '', trim: true },
  categories: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  isAlcohol: { type: Boolean, default: false },
  image: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('BeverageItem', BeverageItemSchema);
