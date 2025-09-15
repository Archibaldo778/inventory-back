import mongoose from 'mongoose';

const staffSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    photo: { type: String, trim: true, default: '' }, // URL or filename
    positions: { type: [String], default: [] }, // e.g., ['Waiter','Bartender']
    note: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
    height: { type: String, trim: true, default: '' },
    shirtSize: { type: String, trim: true, default: '' },
    pantsSize: { type: String, trim: true, default: '' },
    shoeSize: { type: String, trim: true, default: '' },
    jacketSize: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Staff', staffSchema);
