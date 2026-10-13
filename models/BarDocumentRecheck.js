import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  signature: String,
  status: String,
  lease: String,
  lockedUntil: Date,
  nextAttemptAt: Date,
  attempts: { type: Number, default: 0 },
  message: String,
}, { timestamps: true });
export default mongoose.model('BarDocumentRecheck', schema);
