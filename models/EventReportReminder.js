import mongoose from 'mongoose';

// One durable delivery per event, captain and reminder stage (24 / 36 / 48 hours).
const schema = new mongoose.Schema({
  _id: { type: String },
  reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventReport', required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'cancelled'], default: 'pending' },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  firstAttemptAt: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  providerId: { type: String, default: '' },
  error: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('EventReportReminder', schema);
