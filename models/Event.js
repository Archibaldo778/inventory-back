import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: String, trim: true },
    client: { type: String, trim: true },
    managerId: { type: String, trim: true },
    status: { type: String, trim: true, default: 'draft' },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

const Event = mongoose.model('Event', eventSchema);
export default Event;

