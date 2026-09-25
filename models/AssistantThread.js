import mongoose from 'mongoose';

const assistantMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, trim: true, maxlength: 12000 },
  context: {
    path: { type: String, default: '', trim: true, maxlength: 1000 },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
    eventTitle: { type: String, default: '', trim: true, maxlength: 300 },
  },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const assistantThreadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  messages: { type: [assistantMessageSchema], default: [] },
  lastDigestSeenAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('AssistantThread', assistantThreadSchema);
