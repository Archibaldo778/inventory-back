import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  image: { type: String, required: true },
  archivedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('UniformWardrobeAsset', schema);
