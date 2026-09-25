import mongoose from 'mongoose';

const historicalEventReportSchema = new mongoose.Schema({
  provider: { type: String, default: 'dropbox', index: true },
  namespaceId: { type: String, trim: true, default: '', index: true },
  dropboxId: { type: String, required: true, trim: true, unique: true },
  path: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  extension: { type: String, trim: true, default: '', index: true },
  size: { type: Number, default: 0, min: 0 },
  rev: { type: String, trim: true, default: '' },
  contentHash: { type: String, trim: true, default: '' },
  clientModifiedAt: { type: Date, default: null },
  serverModifiedAt: { type: Date, default: null },
  inferredDate: { type: String, trim: true, default: '', index: true },
  inferredYear: { type: Number, default: null, index: true },
  inferredTitle: { type: String, trim: true, default: '' },
  reportType: { type: String, enum: ['captain', 'kitchen', 'unknown'], default: 'unknown', index: true },
  supported: { type: Boolean, default: false, index: true },
  linkedEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
  matchType: { type: String, enum: ['none', 'exact'], default: 'none', index: true },
  ingestionStatus: {
    type: String,
    enum: ['discovered', 'extracted', 'vectorized', 'skipped', 'failed'],
    default: 'discovered',
    index: true,
  },
  extractionError: { type: String, trim: true, default: '' },
  openaiFileId: { type: String, trim: true, default: '' },
  vectorStoreFileId: { type: String, trim: true, default: '' },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

historicalEventReportSchema.index({ inferredDate: 1, inferredTitle: 1 });
historicalEventReportSchema.index({ linkedEventId: 1, serverModifiedAt: -1 });

export default mongoose.model('HistoricalEventReport', historicalEventReportSchema);
