import mongoose from 'mongoose';
import { BAR_PRICE_UNITS } from './BarEvent.js';

const barPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    baseRate: { type: Number, default: 0, min: 0 },
    priceUnit: { type: String, enum: BAR_PRICE_UNITS, default: 'flat' },
    additionalHourRate: { type: Number, default: 0, min: 0 },
    defaultServiceHours: { type: Number, default: null, min: 0 },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

barPackageSchema.index({ active: 1, name: 1 });

export default mongoose.model('BarPackage', barPackageSchema);
