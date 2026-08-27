import mongoose from 'mongoose';

const documentImportRunSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    eventTitle: { type: String, trim: true, default: '' },
    batchId: { type: String, trim: true, default: '', index: true },
    documentType: { type: String, enum: ['po', 'kitchen_menu'], required: true, index: true },
    action: { type: String, enum: ['uploaded', 'replaced', 'corrected_type', 'reprocessed'], required: true },
    fileName: { type: String, trim: true, default: '' },
    version: { type: Number, min: 1, default: 1 },
    checksum: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['applied', 'undone', 'conflict'], default: 'applied', index: true },
    beforeDocuments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    afterDocuments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    beforeBarEvent: { type: mongoose.Schema.Types.Mixed, default: null },
    afterBarEvent: { type: mongoose.Schema.Types.Mixed, default: null },
    createdBy: { type: String, trim: true, default: '' },
    createdById: { type: String, trim: true, default: '' },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: String, trim: true, default: '' },
    undoMessage: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

const DocumentImportRun = mongoose.model('DocumentImportRun', documentImportRunSchema);
export default DocumentImportRun;
