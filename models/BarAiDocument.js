import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  result: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, expires: 2592000 },
});
export default mongoose.model('BarAiDocument', schema);
