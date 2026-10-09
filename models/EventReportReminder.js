import mongoose from 'mongoose';

// One durable delivery per event, captain and reminder stage (12 / 24 / 36 hours; existing stage keys are retained).
const schema = new mongoose.Schema({
  _id: { type: String },
  requestedBy: { type: String, default: '' },
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
