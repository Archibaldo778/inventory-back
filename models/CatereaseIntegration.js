import mongoose from 'mongoose';

const catereaseIntegrationSchema = new mongoose.Schema({
  provider: { type: String, default: 'caterease', unique: true, immutable: true },
  enabled: { type: Boolean, default: true },
  lastSyncStartedAt: { type: Date, default: null },
  lastSyncCompletedAt: { type: Date, default: null },
  lastSyncError: { type: String, trim: true, default: '' },
  lastSyncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastRecipeSyncStartedAt: { type: Date, default: null },
  lastRecipeSyncCompletedAt: { type: Date, default: null },
  lastRecipeSyncError: { type: String, trim: true, default: '' },
  lastRecipeSyncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastOperationalSyncStartedAt: { type: Date, default: null },
  lastOperationalSyncCompletedAt: { type: Date, default: null },
  lastOperationalSyncError: { type: String, trim: true, default: '' },
  lastOperationalSyncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export default mongoose.model('CatereaseIntegration', catereaseIntegrationSchema);
