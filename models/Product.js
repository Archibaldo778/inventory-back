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

const productLocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Product schema updated to store supplier/location, size metadata, and Cloudinary data
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // Human-facing identifier. Mongo `_id` remains the internal relation key.
    inventoryCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true, immutable: true },
    legacyInventoryId: { type: String, trim: true },

    // inventory
    quantity: { type: Number, default: 0, min: 0 },
    locations: { type: [productLocationSchema], default: undefined },

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
