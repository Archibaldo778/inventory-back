import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'BarEvent', required: true },
  recipient: { type: String, required: true },
  senderId: { type: String, required: true },
  senderName: { type: String, default: '' },
  attemptId: { type: String, required: true },
  lockedUntil: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  sentAt: { type: Date, default: null },
  providerId: { type: String, default: '' },
  error: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('BarReturnReminder', schema);
