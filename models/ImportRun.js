import mongoose from 'mongoose';

const importOperationSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['created', 'updated', 'event_id_assigned', 'duplicates_merged', 'skipped', 'failed'],
      required: true,
    },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
    externalId: { type: String, trim: true, default: '' },
    title: { type: String, trim: true, default: '' },
    date: { type: String, trim: true, default: '' },
    message: { type: String, trim: true, default: '' },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    undoable: { type: Boolean, default: true },
    undoStatus: {
      type: String,
      enum: ['', 'undone', 'conflict', 'skipped'],
      default: '',
    },
    undoMessage: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const importRunSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['event_calendar'], required: true, index: true },
    source: { type: String, trim: true, default: '' },
    fileName: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['applied', 'partially_undone', 'undone'], default: 'applied', index: true },
    createdBy: { type: String, trim: true, default: '' },
    createdById: { type: String, trim: true, default: '' },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    operations: { type: [importOperationSchema], default: [] },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

const ImportRun = mongoose.model('ImportRun', importRunSchema);
export default ImportRun;
