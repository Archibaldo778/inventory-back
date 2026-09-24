import mongoose from 'mongoose';

const nowstaDepartmentSchema = new mongoose.Schema({
  nowstaDepartmentId: { type: String, required: true, unique: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  archived: { type: Boolean, default: false, index: true },
  lastSyncedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

export default mongoose.model('NowstaDepartment', nowstaDepartmentSchema);
