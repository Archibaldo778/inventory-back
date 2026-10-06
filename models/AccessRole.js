import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  baseRole: { type: String, required: true },
  jobTitle: { type: String, default: '' },
  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  revision: { type: Number, default: 0 },
  audit: { type: [new mongoose.Schema({
    actorId: { type: String, required: true },
    at: { type: Date, required: true },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
  }, { _id: false })], default: [] },
}, { timestamps: true });

export default mongoose.model('AccessRole', schema);
