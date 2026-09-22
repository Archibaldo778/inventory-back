import mongoose from 'mongoose';

const notificationStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  notificationId: { type: String, required: true, trim: true, maxlength: 300 },
  readAt: { type: Date, default: null },
  pinned: { type: Boolean, default: false },
}, { timestamps: true });

notificationStateSchema.index({ userId: 1, notificationId: 1 }, { unique: true });
notificationStateSchema.index({ userId: 1, pinned: -1, updatedAt: -1 });

export default mongoose.model('NotificationState', notificationStateSchema);
