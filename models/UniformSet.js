import mongoose from 'mongoose';

const uniformSetMemberSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniformItem', default: null },
    name: { type: String, trim: true, default: '' },
    src: { type: String, trim: true, required: true },
    offsetX: { type: Number, required: true },
    offsetY: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    rotation: { type: Number, default: 0 },
    flipX: { type: Boolean, default: false },
    flipY: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const uniformSetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    anchorWidth: { type: Number, default: 0 },
    anchorHeight: { type: Number, default: 0 },
    members: { type: [uniformSetMemberSchema], default: [] },
    createdBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

uniformSetSchema.index({ name: 1 });

const UniformSet = mongoose.model('UniformSet', uniformSetSchema);
export default UniformSet;
