import mongoose from 'mongoose';

const settings = new mongoose.Schema({
  _id: { type: String, default: 'inventory' },
  enabled: { type: Boolean, default: false },
  destination: mongoose.Schema.Types.Mixed,
  enabledBy: String,
  enabledAt: Date,
  lease: String,
  lockedUntil: Date,
  lastRunAt: Date,
  lastError: String,
}, { timestamps: true });
const job = new mongoose.Schema({
  _id: String,
  payload: mongoose.Schema.Types.Mixed,
  idempotencyKey: String,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'review'], default: 'pending' },
  itemNum: String,
  error: String,
}, { timestamps: true });
export const InventorySyncSettings = mongoose.model('CatereaseInventorySettings', settings);
export const InventorySyncJob = mongoose.model('CatereaseInventoryJob', job);
