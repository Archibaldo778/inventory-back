import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  fileName: { type: String, required: true },
  size: { type: Number, required: true },
  pageCount: { type: Number, required: true },
  checksum: { type: String, required: true },
  uploadedBy: { type: String, default: '' },
  // Uploads are capped at 10 MB, below MongoDB's document limit. File bytes
  // stay private and are never included in list responses.
  data: { type: Buffer, required: true, select: false },
}, { timestamps: true });
schema.index({ eventId: 1, checksum: 1 }, { unique: true });
export default mongoose.model('EventReportFile', schema);
