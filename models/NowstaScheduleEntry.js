import mongoose from 'mongoose';

const workerSchema = new mongoose.Schema({
  companyUserId: { type: String, default: '', trim: true },
  name: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  phone: { type: String, default: '', trim: true },
  status: { type: String, default: '', trim: true },
  agency: { type: Boolean, default: false },
}, { _id: false });

const shiftSchema = new mongoose.Schema({
  nowstaShiftId: { type: String, default: '', trim: true },
  position: { type: String, default: '', trim: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  startTime: { type: String, default: '', trim: true },
  endTime: { type: String, default: '', trim: true },
  workers: { type: [workerSchema], default: [] },
  unfilled: { type: Number, default: 0, min: 0 },
}, { _id: false });

const nowstaScheduleEntrySchema = new mongoose.Schema({
  nowstaEventId: { type: String, required: true, unique: true, trim: true },
  companyId: { type: String, default: '', trim: true },
  externalId: { type: String, default: '', trim: true },
  title: { type: String, required: true, trim: true },
  client: { type: String, default: '', trim: true },
  date: { type: String, required: true, trim: true, index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  timeZone: { type: String, default: 'America/New_York', trim: true },
  departmentId: { type: String, default: '', trim: true },
  departmentName: { type: String, default: '', trim: true, index: true },
  entryType: { type: String, default: 'event', trim: true, index: true },
  staffingProgress: { type: String, default: 'empty', trim: true, index: true },
  archived: { type: Boolean, default: false, index: true },
  defaultVisible: { type: Boolean, default: false, index: true },
  venue: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  guestCount: { type: Number, default: null, min: 0 },
  notes: { type: String, default: '', trim: true },
  shifts: { type: [shiftSchema], default: [] },
  sourceUpdatedAt: { type: Date, default: null },
  lastSyncedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

nowstaScheduleEntrySchema.index({ date: 1, departmentName: 1, startsAt: 1 });

export default mongoose.model('NowstaScheduleEntry', nowstaScheduleEntrySchema);
