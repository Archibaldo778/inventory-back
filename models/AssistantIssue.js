import mongoose from 'mongoose';

const assistantIssueSchema = new mongoose.Schema({
  reporterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reporterName: { type: String, default: '', trim: true, maxlength: 200 },
  reporterEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 320 },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  summary: { type: String, required: true, trim: true, maxlength: 500 },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium', index: true },
  path: { type: String, default: '', trim: true, maxlength: 1000 },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

assistantIssueSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('AssistantIssue', assistantIssueSchema);
