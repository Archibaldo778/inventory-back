import mongoose from 'mongoose';

const encryptedSecretSchema = new mongoose.Schema({
  ciphertext: { type: String, default: '', select: false },
  iv: { type: String, default: '', select: false },
  tag: { type: String, default: '', select: false },
}, { _id: false });

const outlookIntegrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  microsoftUserId: { type: String, trim: true, default: '' },
  accountEmail: { type: String, trim: true, lowercase: true, default: '' },
  displayName: { type: String, trim: true, default: '' },
  refreshToken: { type: encryptedSecretSchema, default: () => ({}) },
  connectedAt: { type: Date, default: null },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('OutlookIntegration', outlookIntegrationSchema);
