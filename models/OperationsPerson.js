import mongoose from 'mongoose';

const operationsPersonSchema = new mongoose.Schema({
  nowstaCompanyUserId: { type: String, required: true, unique: true, trim: true, index: true },
  fullName: { type: String, required: true, trim: true, index: true },
  firstName: { type: String, default: '', trim: true },
  lastName: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  phone: { type: String, default: '', trim: true },
  roles: { type: [String], default: ['Driver'] },
  sourceEmail: { type: String, default: '', trim: true, lowercase: true },
  sourcePhone: { type: String, default: '', trim: true },
  sourceRoles: { type: [String], default: [] },
  departments: { type: [String], default: [] },
  note: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

export default mongoose.model('OperationsPerson', operationsPersonSchema);
