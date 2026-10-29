import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  image: { type: String, required: true },
  tieStyle: { type: String, enum: ['tie', 'no-tie'] },
  alternateImage: { type: String },
  defaultLook: { type: String, enum: ['base', 'alternate'] },
  colorName: { type: String, trim: true, default: 'Original' },
  swatch: { type: String, default: '#808080' },
  variants: { type: [new mongoose.Schema({
    id: { type: String, required: true },
    colorName: { type: String, required: true, maxlength: 60 },
    colorKey: { type: String, required: true },
    swatch: { type: String, required: true },
    image: { type: String, required: true },
  }, { _id: false })], default: undefined },
  archivedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('UniformWardrobeAsset', schema);
