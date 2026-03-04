import mongoose from 'mongoose';

const PRICE_UNITS = ['per_person', 'per_hour', 'flat', 'per_unit'];
const TEMPLATE_TYPES = ['group', 'station', 'package', 'upgrade'];
const TEMPLATE_SOURCE_TYPES = ['kitchen', 'beverage', 'decor', 'staff', 'custom'];

const templateOptionSchema = new mongoose.Schema(
  {
    key: { type: String, default: '', trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    sourceType: { type: String, enum: TEMPLATE_SOURCE_TYPES, default: 'custom' },
    sourceRef: { type: String, default: '', trim: true },
    dietary: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    sectionCategory: { type: String, default: '', trim: true },
    subCategory: { type: String, default: '', trim: true },
    supplementPrice: { type: Number, default: 0 },
    priceUnit: { type: String, enum: PRICE_UNITS, default: 'per_person' },
    defaultSelected: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const proposalTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    section: { type: String, default: '', trim: true, index: true },
    subSection: { type: String, default: '', trim: true },
    type: { type: String, enum: TEMPLATE_TYPES, default: 'group', index: true },
    sourcePages: { type: [Number], default: [] },
    sourceLabel: { type: String, default: '', trim: true },
    currency: { type: String, default: 'USD', trim: true },
    basePrice: { type: Number, default: null },
    priceUnit: { type: String, enum: PRICE_UNITS, default: 'per_person' },
    additionalHourPrice: { type: Number, default: null },
    defaultSelectCount: { type: Number, default: 0 },
    minSelectCount: { type: Number, default: 0 },
    maxSelectCount: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    options: { type: [templateOptionSchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

proposalTemplateSchema.index({ section: 1, type: 1, sortOrder: 1, updatedAt: -1 });
proposalTemplateSchema.index({ title: 'text', section: 'text', subSection: 'text', tags: 'text' });

const ProposalTemplate = mongoose.model('ProposalTemplate', proposalTemplateSchema);

export { PRICE_UNITS, TEMPLATE_TYPES, TEMPLATE_SOURCE_TYPES };
export default ProposalTemplate;
