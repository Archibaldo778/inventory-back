import mongoose from 'mongoose';

const deckSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', index: true },
    type: { type: String, enum: ['decor', 'staff', 'uniform', 'generic', 'kitchen'], default: 'decor' },
    title: { type: String, trim: true },
    pages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Page' }],
  },
  { timestamps: true }
);

const Deck = mongoose.model('Deck', deckSchema);
export default Deck;
