import mongoose from 'mongoose';

const automationAlertRuleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  department: { type: String, required: true, trim: true, maxlength: 120 },
  source: { type: String, enum: ['caterease_packout'], default: 'caterease_packout' },
  enabled: { type: Boolean, default: true },
  matchTerms: { type: [String], default: [] },
  recipients: { type: [String], default: [] },
  subjectPrefix: { type: String, trim: true, maxlength: 160, default: 'ACTION REQUIRED' },
  seededKey: { type: String, trim: true, sparse: true, unique: true },
  createdBy: { type: String, trim: true, maxlength: 200, default: '' },
  updatedBy: { type: String, trim: true, maxlength: 200, default: '' },
}, { timestamps: true });

automationAlertRuleSchema.index({ enabled: 1, source: 1 });

export default mongoose.model('AutomationAlertRule', automationAlertRuleSchema);
