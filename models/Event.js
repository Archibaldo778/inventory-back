import mongoose from 'mongoose';

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
    deckRevision: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true }
);

const Event = mongoose.model('Event', eventSchema);
export default Event;
