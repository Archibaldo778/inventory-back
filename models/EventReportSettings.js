import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema({
  slackUserId: { type: String, default: '', trim: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
}, { _id: false });

const eventReportSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  recipients: { type: [recipientSchema], default: [] },
  emailEnabled: { type: Boolean, default: false },
  historicalArchive: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: String, default: '', trim: true },
}, { timestamps: true });

export default mongoose.model('EventReportSettings', eventReportSettingsSchema);
