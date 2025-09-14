import mongoose from 'mongoose';

const staffSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    photo: { type: String, trim: true, default: '' }, // URL or filename
    positions: { type: [String], default: [] }, // e.g., ['Waiter','Bartender']
    note: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Staff', staffSchema);

