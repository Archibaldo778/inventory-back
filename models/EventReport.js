import mongoose from 'mongoose';

const eventReportSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  nowstaEventId: { type: String, default: '', trim: true },
  eventTitle: { type: String, required: true, trim: true },
  eventDate: { type: String, default: '', trim: true },
  eventEndsAt: { type: Date, default: null, index: true },
  slackUserId: { type: String, required: true, trim: true, index: true },
  reporterName: { type: String, default: '', trim: true },
  reporterEmail: { type: String, default: '', trim: true, lowercase: true },
  position: { type: String, default: '', trim: true },
  status: { type: String, enum: ['pending', 'submitted'], default: 'pending', index: true },
  requestSentAt: { type: Date, default: null },
  lastReminderAt: { type: Date, default: null },
  nextReminderAt: { type: Date, default: null, index: true },
  reminderCount: { type: Number, default: 0, min: 0 },
  submittedAt: { type: Date, default: null },
  answers: {
    overallSummary: { type: String, default: '', trim: true },
    issues: { type: String, default: '', trim: true },
    staffingNotes: { type: String, default: '', trim: true },
    kitchenNotes: { type: String, default: '', trim: true },
    clientFeedback: { type: String, default: '', trim: true },
    followUpRequired: { type: Boolean, default: false },
  },
}, { timestamps: true });

eventReportSchema.index({ eventId: 1, slackUserId: 1 }, { unique: true });

export default mongoose.model('EventReport', eventReportSchema);
