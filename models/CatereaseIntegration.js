import mongoose from 'mongoose';

const catereaseIntegrationSchema = new mongoose.Schema({
  provider: { type: String, default: 'caterease', unique: true, immutable: true },
  enabled: { type: Boolean, default: true },
  lastSyncStartedAt: { type: Date, default: null },
  lastSyncCompletedAt: { type: Date, default: null },
  lastSyncError: { type: String, trim: true, default: '' },
  lastSyncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export default mongoose.model('CatereaseIntegration', catereaseIntegrationSchema);
