import mongoose from 'mongoose';

const eventDocumentItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, trim: true },
    section: { type: String, trim: true },
  },
  { _id: false }
);

const eventDocumentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['po', 'kitchen_menu'], required: true },
    fileName: { type: String, required: true, trim: true },
    contentType: { type: String, trim: true },
    size: { type: Number, default: 0, min: 0 },
    checksum: { type: String, trim: true },
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true },
    version: { type: Number, default: 1, min: 1 },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: String, trim: true },
    kitchenItems: { type: [eventDocumentItemSchema], default: undefined },
  },
  { _id: true }
);

const eventSchema = new mongoose.Schema(
  {
    externalId: { type: String, trim: true, index: true, sparse: true },
    importSource: { type: String, trim: true, default: '' },
    title: { type: String, required: true, trim: true },
    date: { type: String, trim: true },
    client: { type: String, trim: true },
    managerId: { type: String, trim: true },
    status: { type: String, trim: true, default: 'draft' },
    meta: { type: Object, default: {} },
    documents: { type: [eventDocumentSchema], default: [] },
    documentHistory: { type: [eventDocumentSchema], default: [] },
    deckRevision: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true }
);

const Event = mongoose.model('Event', eventSchema);
export default Event;
