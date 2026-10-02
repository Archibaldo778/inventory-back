import mongoose from 'mongoose';

// Explicitly requested, personal previews; never the normal report mailing list.
const schema = new mongoose.Schema({
  reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventReport', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: String, required: true, trim: true, lowercase: true },
  status: { type: String, enum: ['queued', 'processing', 'sent', 'failed'], default: 'queued', index: true },
  reportSnapshot: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  summary: { type: mongoose.Schema.Types.Mixed, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  sendAttemptedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  providerId: { type: String, default: '' },
  error: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('EventReportEmailPreview', schema);
