import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, default: 'bar' },
  rules: { type: String, default: '' },
  revision: { type: Number, default: 0 },
  audit: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
export default mongoose.model('BarAiSettings', schema);
