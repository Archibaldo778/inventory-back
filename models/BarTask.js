import mongoose from 'mongoose';

const barTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    scheduledDate: { type: String, required: true, trim: true, index: true },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BarEvent',
      default: null,
      index: true,
    },
    eventItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    cocktailRecipeKey: { type: String, default: '', trim: true },
    cocktailName: { type: String, default: '', trim: true },
    assigneeStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
      index: true,
    },
    assigneeName: { type: String, default: '', trim: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, default: '', trim: true },
    createdBy: { type: String, default: '', trim: true },
    updatedBy: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

barTaskSchema.index({ scheduledDate: 1, completedAt: 1 });

export default mongoose.model('BarTask', barTaskSchema);
