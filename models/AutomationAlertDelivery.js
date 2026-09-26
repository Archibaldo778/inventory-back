import mongoose from 'mongoose';

const automationAlertDeliverySchema = new mongoose.Schema({
  ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationAlertRule', required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  signature: { type: String, required: true, trim: true },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  recipients: { type: [String], default: [] },
  matchedItems: { type: [mongoose.Schema.Types.Mixed], default: [] },
  providerId: { type: String, trim: true, default: '' },
  error: { type: String, trim: true, default: '' },
  attempts: { type: Number, default: 0, min: 0 },
  sentAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null },
}, { timestamps: true });

automationAlertDeliverySchema.index({ ruleId: 1, eventId: 1, signature: 1 }, { unique: true });
automationAlertDeliverySchema.index({ createdAt: -1 });

export default mongoose.model('AutomationAlertDelivery', automationAlertDeliverySchema);
