import mongoose from 'mongoose';

const deckSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    type: { type: String, enum: ['decor', 'staff', 'uniform', 'generic', 'kitchen', 'board'], default: 'decor' },
    title: { type: String, trim: true },
    pages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Page' }],
  },
  { timestamps: true }
);

deckSchema.index({ eventId: 1, type: 1, createdAt: -1 });

const Deck = mongoose.model('Deck', deckSchema);
export default Deck;
