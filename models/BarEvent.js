import mongoose from 'mongoose';

const BAR_EVENT_STATUSES = [
  'draft',
  'ready',
  'in_progress',
  'submitted',
  'reviewed',
  'closed',
];

const BAR_ITEM_SCOPES = ['alcohol', 'bar_support', 'non_bar', 'review'];
const BAR_PRICE_UNITS = ['per_person', 'per_hour', 'flat', 'per_unit'];

const barPackoutItemSchema = new mongoose.Schema(
  {
    beverageItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BeverageItem',
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    section: { type: String, default: '', trim: true },
    scope: { type: String, enum: BAR_ITEM_SCOPES, default: 'review' },
    included: { type: Boolean, default: true },
    sentQty: { type: Number, default: 0, min: 0 },
    sentQtyText: { type: String, default: '', trim: true },
    sentQtyPending: { type: Boolean, default: false },
    deliveredQty: { type: Number, default: null, min: 0 },
    returnedFullQty: { type: Number, default: 0, min: 0 },
    returnedOpenQty: { type: Number, default: 0, min: 0 },
    lostDamagedQty: { type: Number, default: 0, min: 0 },
    returnConfirmed: { type: Boolean, default: false },
    unitCostSnapshot: { type: Number, default: 0, min: 0 },
    bottleSizeMl: { type: Number, default: null, min: 0 },
    notes: { type: String, default: '', trim: true },
    captainNotes: { type: String, default: '', trim: true },
    updatedBy: { type: String, default: '', trim: true },
    updatedAt: { type: Date, default: null },
  },
  { _id: true }
);

const barAuditEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    userId: { type: String, default: '', trim: true },
    username: { type: String, default: '', trim: true },
    at: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const barEventSchema = new mongoose.Schema(
  {
    linkedEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    eventNumber: { type: String, default: '', trim: true, index: true },
    name: { type: String, required: true, trim: true },
    eventDate: { type: String, default: '', trim: true, index: true },
    client: { type: String, default: '', trim: true },
    venue: { type: String, default: '', trim: true },
    salesRep: { type: String, default: '', trim: true },
    eventTiming: { type: String, default: '', trim: true },
    deliveryTime: { type: String, default: '', trim: true },
    guestCount: { type: Number, default: null, min: 0 },
    status: { type: String, enum: BAR_EVENT_STATUSES, default: 'draft', index: true },
    assignedUserIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    packageSnapshot: {
      name: { type: String, default: '', trim: true },
      baseRate: { type: Number, default: 0, min: 0 },
      overrideRate: { type: Number, default: null, min: 0 },
      priceUnit: { type: String, enum: BAR_PRICE_UNITS, default: 'flat' },
      additionalHourRate: { type: Number, default: 0, min: 0 },
      serviceHours: { type: Number, default: null, min: 0 },
      includedHours: { type: Number, default: null, min: 0 },
      pricingQuantity: { type: Number, default: null, min: 0 },
    },
    clientCharge: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD', trim: true },
    packout: {
      fileName: { type: String, default: '', trim: true },
      contentType: { type: String, default: '', trim: true },
      packoutType: {
        type: String,
        enum: ['unknown', 'general', 'bar_only', 'alcohol_only'],
        default: 'unknown',
      },
      importedAt: { type: Date, default: null },
      importedBy: { type: String, default: '', trim: true },
    },
    items: { type: [barPackoutItemSchema], default: [] },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: String, default: '', trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    guestIntake: {
      pendingReview: { type: Boolean, default: false },
      dedupeKey: { type: String, default: '', trim: true },
      reporterName: { type: String, default: '', trim: true },
      createdAt: { type: Date, default: null },
      lastSubmittedAt: { type: Date, default: null },
    },
    audit: { type: [barAuditEntrySchema], default: [] },
    revision: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

barEventSchema.index({ assignedUserIds: 1, eventDate: -1 });
barEventSchema.index({ status: 1, eventDate: -1 });
barEventSchema.index(
  { 'guestIntake.dedupeKey': 1 },
  {
    unique: true,
    partialFilterExpression: { 'guestIntake.dedupeKey': { $type: 'string', $gt: '' } },
  }
);
barEventSchema.index(
  { linkedEventId: 1 },
  {
    unique: true,
    partialFilterExpression: { linkedEventId: { $type: 'objectId' } },
  }
);

const BarEvent = mongoose.model('BarEvent', barEventSchema);

export {
  BAR_EVENT_STATUSES,
  BAR_ITEM_SCOPES,
  BAR_PRICE_UNITS,
};
export default BarEvent;
