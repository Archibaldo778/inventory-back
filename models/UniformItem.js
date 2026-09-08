import mongoose from 'mongoose';

const uniformSizeSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const uniformItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, index: true },
    description: { type: String, trim: true },
    color: { type: String, trim: true },
    material: { type: String, trim: true },
    supplier: { type: String, trim: true },
    location: { type: String, trim: true },
    sizes: { type: [uniformSizeSchema], default: [] },
    quantity: { type: Number, default: 0, min: 0 },
    image: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    images: [{ type: String, trim: true }],
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

uniformItemSchema.pre('validate', function syncUniformQuantity(next) {
  this.quantity = (Array.isArray(this.sizes) ? this.sizes : [])
    .reduce((sum, size) => sum + Math.max(0, Number(size?.quantity) || 0), 0);
  next();
});

export default mongoose.model('UniformItem', uniformItemSchema);
