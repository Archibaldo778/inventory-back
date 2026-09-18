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
    sourceProvider: { type: String, trim: true },
    sourceId: { type: String, trim: true },
    sourcePath: { type: String, trim: true },
    sourceSeries: { type: String, trim: true },
    sourceRevision: { type: String, trim: true },
    kitchenItems: { type: [eventDocumentItemSchema], default: undefined },
    barItems: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  { _id: true }
);

const catereaseManualAdditionSchema = new mongoose.Schema(
  {
    documentType: { type: String, enum: ['po', 'kitchen_packout', 'staff_request', 'kitchen_menu', 'annotated_kitchen_menu'], required: true },
    templateKey: { type: String, default: '', trim: true },
    zoneKey: { type: String, default: '', trim: true },
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    station: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true },
    addedBy: { type: String, default: '', trim: true },
    addedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: '', trim: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const kitchenPackOutBlueprintRowSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['heading', 'item'], required: true },
    label: { type: String, default: '', trim: true },
    itemName: { type: String, default: '', trim: true },
    quantityText: { type: String, default: '', trim: true },
    notEnough: { type: String, default: '', trim: true },
    justEnough: { type: String, default: '', trim: true },
    tooMuch: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const kitchenPackOutBlueprintSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    rows: { type: [kitchenPackOutBlueprintRowSchema], default: [] },
    importedBy: { type: String, default: '', trim: true },
    importedAt: { type: Date, default: Date.now },
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
    catereaseOperations: { type: mongoose.Schema.Types.Mixed, default: null },
    catereaseManualAdditions: { type: [catereaseManualAdditionSchema], default: [] },
    kitchenPackOutBlueprints: { type: [kitchenPackOutBlueprintSchema], default: [] },
    deckRevision: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true }
);

eventSchema.index({ date: 1, status: 1 });

const Event = mongoose.model('Event', eventSchema);
export default Event;
