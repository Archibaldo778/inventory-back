import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  name: { type: String, required: true },
  design: { type: mongoose.Schema.Types.Mixed, required: true },
  revision: { type: Number, default: 0 },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('EventMenuCard', schema);
