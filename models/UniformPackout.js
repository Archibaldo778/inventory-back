import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniformItem', required: true },
  name: { type: String, required: true },
  size: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const bagSchema = new mongoose.Schema({
  id: { type: String, required: true },
  number: { type: Number, required: true, min: 1 },
  lines: { type: [lineSchema], default: [] },
  notes: { type: String, default: '', maxlength: 400 },
}, { _id: false });

const schema = new mongoose.Schema({
  nowstaEventId: { type: String, required: true, unique: true },
  revision: { type: Number, default: 0, min: 0 },
  lines: { type: [lineSchema], default: [] },
  bags: { type: [bagSchema], default: undefined },
  notes: { type: String, default: '' },
  rosterSizes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  rosterImport: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('UniformPackout', schema);
