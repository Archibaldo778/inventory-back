import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  status: { type: String, enum: ['waiting', 'queued', 'processing', 'sent', 'no_notes', 'expired'], default: 'waiting' },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockToken: { type: String, default: '' },
  lockedUntil: { type: Date, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  firstAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  error: { type: String, default: '' },
  venueKey: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('VenueReportNotification', schema);
