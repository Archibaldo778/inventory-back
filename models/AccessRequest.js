import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, required: true }, // Normalized email: one request per address.
  name: { type: String, required: true, maxlength: 240 },
  passwordHash: { type: String, select: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'activating', 'completed'], default: 'pending' },
  role: { type: String, default: '' },
  requestedAt: { type: Date, default: Date.now },
  activationHash: { type: String, select: false, default: '' },
  activationExpiresAt: { type: Date, default: null },
  emailAttemptAt: { type: Date, default: null },
  emailSentAt: { type: Date, default: null },
  reviewedBy: { type: String, default: '' },
});

export default mongoose.model('AccessRequest', schema);
