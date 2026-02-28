import mongoose from 'mongoose';

const sizeDimensionsSchema = new mongoose.Schema(
  {
    width: { type: Number },
    height: { type: Number },
    depth: { type: Number },
    length: { type: Number },
  },
  { _id: false, strict: false }
);

// Product schema updated to store supplier/location, size metadata, and Cloudinary data
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // inventory
    quantity: { type: Number, default: 0, min: 0 },

    // optional meta
    description: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    material: { type: String, trim: true },
    color: { type: String, trim: true },
    supplier: { type: String, trim: true },
    location: { type: String, trim: true },

    // sizes (kept redundant for backward/forward compatibility)
    sizes: [{ type: String, trim: true }],
    sizeOptions: [{ type: String, trim: true }],
    selectedSize: { type: String, trim: true },
    sizeLabel: { type: String, trim: true },
    sizeWidth: { type: String, trim: true },
    sizeHeight: { type: String, trim: true },
    sizeDepth: { type: String, trim: true },
    sizeLetter: { type: String, trim: true },
    selectedSizeDimensions: { type: sizeDimensionsSchema, default: undefined },

    // image storage
    // keep legacy `image` for backward compatibility
    image: { type: String, trim: true },
    imageUrl: { type: String, trim: true },        // Cloudinary secure URL
    imagePublicId: { type: String, trim: true },   // Cloudinary public_id

    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const Product = mongoose.model('Product', productSchema);
export default Product;
