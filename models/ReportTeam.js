import mongoose from 'mongoose';

const reportTeamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  salesUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  salesAliases: { type: [String], default: [] },
  reportDeliveryEnabled: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('ReportTeam', reportTeamSchema);
