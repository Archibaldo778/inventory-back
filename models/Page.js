import mongoose from 'mongoose';

const pageSchema = new mongoose.Schema(
  {
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', required: true, index: true },
    index: { type: Number, default: 0 },
    canvas: { type: Object, default: {} },
    preview: { type: String, default: '' },
    revision: { type: Number, default: 0, min: 0 },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

pageSchema.index({ deckId: 1, deletedAt: 1, index: 1, createdAt: 1 });

const Page = mongoose.model('Page', pageSchema);
export default Page;
