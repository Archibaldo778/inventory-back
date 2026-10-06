import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  aliases: { type: [String], default: [] },
  identityKeys: { type: [String], required: true },
  revision: { type: Number, default: 0 },
  summary: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });
schema.index({ identityKeys: 1 }, { unique: true });
schema.index({ name: 1 });
export default mongoose.model('Venue', schema);
