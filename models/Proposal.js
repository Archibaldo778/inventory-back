import mongoose from 'mongoose';

const PROPOSAL_STATUSES = ['draft', 'sent', 'approved', 'archived'];
const PROPOSAL_SOURCES = ['kitchen', 'beverage', 'decor', 'staff', 'custom'];

const proposalItemSchema = new mongoose.Schema(
  {
    sourceType: { type: String, enum: PROPOSAL_SOURCES, default: 'custom' },
    sourceId: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    image: { type: String, default: '' },
    dietary: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    sectionCategory: { type: String, default: '', trim: true },
    subCategory: { type: String, default: '', trim: true },
    allSeason: { type: Boolean, default: false },
    guestLimit: { type: String, default: '', trim: true },
    unitPrice: { type: Number, default: null },
    priceUnit: { type: String, enum: ['per_person', 'per_hour', 'flat', 'per_unit'], default: 'flat' },
    pricingNote: { type: String, default: '', trim: true },
    qty: { type: Number, default: 1, min: 0 },
    note: { type: String, default: '', trim: true },
    position: { type: Number, default: 0 },
    snapshotMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const proposalSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', index: true, default: null },
    eventTitle: { type: String, default: '', trim: true },
    client: { type: String, default: '', trim: true },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'draft', index: true },
    notes: { type: String, default: '', trim: true },
    items: { type: [proposalItemSchema], default: [] },
    selectedTemplatePages: { type: [Number], default: [] },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: '', trim: true },
    updatedBy: { type: String, default: '', trim: true },
    lastExportedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

proposalSchema.index({ status: 1, updatedAt: -1 });
proposalSchema.index({ title: 'text', eventTitle: 'text', client: 'text' });

const Proposal = mongoose.model('Proposal', proposalSchema);

export { PROPOSAL_STATUSES, PROPOSAL_SOURCES };
export default Proposal;
