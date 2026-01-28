import mongoose from 'mongoose';

const KitchenItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  dietary: { type: [String], default: [] },
  image: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('KitchenItem', KitchenItemSchema);
