import mongoose from 'mongoose';

const KitchenItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  dietary: { type: [String], default: [] },
  categories: { type: [String], default: [] },
  season: { type: String, enum: ['', 'fall_winter', 'spring_summer'], default: '' },
  seasonYear: { type: Number, default: null },
  allSeason: { type: Boolean, default: false },
  seasonWindow: { type: String, enum: ['', 'apr_jun', 'jul_sep'], default: '' },
  guestLimit: { type: String, default: '', trim: true },
  hidden: { type: Boolean, default: false },
  wrongPicture: { type: Boolean, default: false },
  needReview: { type: Boolean, default: false },
  image: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('KitchenItem', KitchenItemSchema);
