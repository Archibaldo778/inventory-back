import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  image: String,
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
export default Product;