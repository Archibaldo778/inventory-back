import mongoose from 'mongoose';

const reportFieldSchema = new mongoose.Schema({
  value: { type: String, default: '', trim: true, maxlength: 40 },
  updatedAt: { type: Date, default: null },
  updatedBy: { type: String, default: '', trim: true, maxlength: 180 },
  updatedById: { type: String, default: '', trim: true, maxlength: 120 },
}, { _id: false });

const calendarReportStatusSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, index: true, trim: true },
  externalId: { type: String, default: '', trim: true, index: true },
  sr: { type: reportFieldSchema, default: () => ({}) },
  km: { type: reportFieldSchema, default: () => ({}) },
  po: { type: reportFieldSchema, default: () => ({}) },
}, { timestamps: true });

export default mongoose.model('CalendarReportStatus', calendarReportStatusSchema);
