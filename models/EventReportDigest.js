import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  status: { type: String, enum: ['waiting', 'queued', 'processing', 'sent', 'expired', 'suppressed'], default: 'waiting' },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockToken: { type: String, default: '' },
  lockedUntil: { type: Date, default: null },
  signature: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  firstAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  providerId: { type: String, default: '' },
  error: { type: String, default: '' },
}, { timestamps: true });
export default mongoose.model('EventReportDigest', schema);
