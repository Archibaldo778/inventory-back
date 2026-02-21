import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true }
);

clientSchema.pre('validate', function (next) {
  if (this.name) this.normalized = String(this.name).trim().toLowerCase();
  next();
});

const Client = mongoose.model('Client', clientSchema);
export default Client;
