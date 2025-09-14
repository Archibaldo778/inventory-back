import mongoose from 'mongoose';

const pageSchema = new mongoose.Schema(
  {
    deckId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deck', index: true },
    index: { type: Number, default: 0 },
    canvas: { type: Object, default: {} },
    preview: { type: String, default: '' },
  },
  { timestamps: true }
);

const Page = mongoose.model('Page', pageSchema);
export default Page;

