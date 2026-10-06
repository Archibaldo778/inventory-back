import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, enum: ['captain', 'kitchen'] },
  revision: { type: Number, required: true },
  introduction: { type: String, default: '' },
  sections: { type: [mongoose.Schema.Types.Mixed], required: true },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });
export default mongoose.model('EventReportTemplate', schema);
