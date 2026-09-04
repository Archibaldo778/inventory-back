import mongoose from 'mongoose';

const dropboxDocumentSchema = new mongoose.Schema({
  provider: { type: String, default: 'dropbox', index: true },
  dropboxId: { type: String, required: true, trim: true, unique: true },
  path: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  rev: { type: String, trim: true, default: '' },
  contentHash: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  clientModifiedAt: { type: Date, default: null },
  serverModifiedAt: { type: Date, default: null },
  documentType: { type: String, enum: ['po', 'kitchen_menu', 'review'], default: 'review', index: true },
  inferredDate: { type: String, trim: true, default: '', index: true },
  eventId: { type: String, trim: true, default: '', index: true },
  revisionNumber: { type: Number, default: null },
  revisionLabel: { type: String, trim: true, default: '' },
  revisionSeries: { type: String, trim: true, default: '' },
  revisionGroupKey: { type: String, trim: true, default: '', index: true },
  contentEventId: { type: String, trim: true, default: '' },
  contentEventTitle: { type: String, trim: true, default: '' },
  contentEventDate: { type: String, trim: true, default: '' },
  contentDocumentType: { type: String, enum: ['po', 'kitchen_menu', 'review'], default: 'review' },
  contentInspectedRev: { type: String, trim: true, default: '' },
  contentInspectedAt: { type: Date, default: null },
  contentInspectionError: { type: String, trim: true, default: '' },
  kitchenItems: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  barItems: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  packoutType: { type: String, trim: true, default: '' },
  isLatestRevision: { type: Boolean, default: false, index: true },
  supersededByDropboxId: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['discovered', 'review', 'superseded', 'skipped_old', 'ignored', 'deleted', 'imported', 'failed'],
    default: 'discovered',
    index: true,
  },
  reason: { type: String, trim: true, default: '' },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  importedAt: { type: Date, default: null },
  importedEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
}, { timestamps: true });

dropboxDocumentSchema.index({ status: 1, inferredDate: 1, serverModifiedAt: -1 });

export default mongoose.model('DropboxDocument', dropboxDocumentSchema);
