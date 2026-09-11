import mongoose from 'mongoose';

const catereaseFileSchema = new mongoose.Schema({
  provider: { type: String, default: 'caterease', immutable: true, index: true },
  uid: { type: Number, required: true, unique: true, index: true },
  catereaseEventId: { type: String, required: true, trim: true, index: true },
  fileName: { type: String, required: true, trim: true },
  comment: { type: String, trim: true, default: '' },
  booked: { type: Boolean, default: false },
  shared: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  revisedAt: { type: Date, default: null },
  etag: { type: String, trim: true, default: '' },
  contentType: { type: String, trim: true, default: '' },
  size: { type: Number, min: 0, default: 0 },
  documentType: { type: String, enum: ['po', 'kitchen_menu', 'review'], default: 'review', index: true },
  sourceSeries: { type: String, trim: true, default: '', index: true },
  isLatestRevision: { type: Boolean, default: false, index: true },
  supersededByUid: { type: Number, default: null },
  status: { type: String, enum: ['imported', 'superseded', 'ignored', 'failed', 'deleted'], default: 'ignored', index: true },
  reason: { type: String, trim: true, default: '' },
  kitchenItems: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  barItems: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  packoutType: { type: String, trim: true, default: '' },
  importedEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

catereaseFileSchema.index({ catereaseEventId: 1, status: 1 });

export default mongoose.model('CatereaseFile', catereaseFileSchema);
