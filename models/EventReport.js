import mongoose from 'mongoose';

const eventReportSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  nowstaEventId: { type: String, default: '', trim: true },
  eventTitle: { type: String, required: true, trim: true },
  eventDate: { type: String, default: '', trim: true },
  eventEndsAt: { type: Date, default: null, index: true },
  reportType: { type: String, enum: ['captain', 'kitchen'], default: 'captain', index: true },
  slackUserId: { type: String, required: true, trim: true, index: true },
  slackRecipientId: { type: String, default: '', trim: true },
  reporterName: { type: String, default: '', trim: true },
  reporterEmail: { type: String, default: '', trim: true, lowercase: true },
  position: { type: String, default: '', trim: true },
  salesRep: { type: String, default: '', trim: true },
  status: { type: String, enum: ['pending', 'submitted'], default: 'pending', index: true },
  requestSentAt: { type: Date, default: null },
  lastReminderAt: { type: Date, default: null },
  nextReminderAt: { type: Date, default: null, index: true },
  reminderCount: { type: Number, default: 0, min: 0 },
  submittedAt: { type: Date, default: null },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  emailDelivery: {
    status: { type: String, enum: ['not_sent', 'pending', 'sent', 'failed'], default: 'not_sent' },
    providerId: { type: String, default: '', trim: true },
    sentAt: { type: Date, default: null },
    recipients: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    error: { type: String, default: '', trim: true },
  },
}, { timestamps: true });

eventReportSchema.index({ eventId: 1, slackUserId: 1 }, { unique: true });

export default mongoose.model('EventReport', eventReportSchema);
