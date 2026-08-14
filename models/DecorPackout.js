import mongoose from 'mongoose';

const decorPackoutItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    inventoryCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    quantity: { type: Number, min: 1, max: 10000, default: 1 },
    scannedAt: { type: Date, default: Date.now },
    scannedBy: { type: String, trim: true, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const decorPackoutSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true, index: true },
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Page', required: true },
    eventTitle: { type: String, trim: true, default: '' },
    eventDate: { type: String, trim: true, default: '' },
    eventClient: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['draft', 'complete'], default: 'draft', index: true },
    items: { type: [decorPackoutItemSchema], default: [] },
    createdByUserId: { type: String, trim: true, default: '' },
    createdBy: { type: String, trim: true, default: '' },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

decorPackoutSchema.index({ eventId: 1, createdAt: -1 });
decorPackoutSchema.index({ deckId: 1, updatedAt: -1 });

const DecorPackout = mongoose.model('DecorPackout', decorPackoutSchema);
export default DecorPackout;
