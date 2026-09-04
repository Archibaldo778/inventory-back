import mongoose from 'mongoose';

const encryptedSecretSchema = new mongoose.Schema({
  ciphertext: { type: String, default: '', select: false },
  iv: { type: String, default: '', select: false },
  tag: { type: String, default: '', select: false },
}, { _id: false });

const dropboxIntegrationSchema = new mongoose.Schema({
  provider: { type: String, default: 'dropbox', unique: true, immutable: true },
  accountId: { type: String, trim: true, default: '' },
  accountEmail: { type: String, trim: true, lowercase: true, default: '' },
  namespaceId: { type: String, trim: true, default: '' },
  homeNamespaceId: { type: String, trim: true, default: '' },
  homePath: { type: String, trim: true, default: '' },
  resolvedRootPath: { type: String, trim: true, default: '' },
  rootPath: { type: String, trim: true, default: '/Proposals' },
  refreshToken: { type: encryptedSecretSchema, default: () => ({}) },
  cursor: { type: String, default: '', select: false },
  connectedAt: { type: Date, default: null },
  connectedBy: { type: String, trim: true, default: '' },
  lastSyncStartedAt: { type: Date, default: null },
  lastSyncCompletedAt: { type: Date, default: null },
  lastSyncError: { type: String, trim: true, default: '' },
  lastSyncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('DropboxIntegration', dropboxIntegrationSchema);
