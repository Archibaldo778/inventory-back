import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String },
  activatedAt: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  lockOwner: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('AutomationAlertPolicy', schema);
