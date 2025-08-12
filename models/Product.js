import mongoose from 'mongoose';

// Product schema updated to store supplier/location and Cloudinary data
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // inventory
    quantity: { type: Number, default: 0, min: 0 },

    // optional meta
    description: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    supplier: { type: String, trim: true },
    location: { type: String, trim: true },

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