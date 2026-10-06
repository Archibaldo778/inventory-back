import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
  sourceKey: { type: String, required: true, unique: true },
  source: { type: String, enum: ['captain', 'manual', 'caterease'], required: true },
  sourceReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventReport', default: null },
  sourceEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  sourceLabel: { type: String, default: '' },
  sourceDate: { type: String, default: '' },
  observedAt: { type: Date, required: true },
  text: { type: String, required: true },
  category: { type: String, enum: ['boh', 'loading', 'access', 'equipment', 'rules', 'other'], default: 'other' },
  kind: { type: String, enum: ['concern', 'positive', 'information'], default: 'information' },
  status: { type: String, enum: ['active', 'needs_review', 'resolved'], default: 'needs_review' },
  resolution: { type: String, default: '' },
  revision: { type: Number, default: 0 },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
schema.index({ venueId: 1, observedAt: -1 });
export default mongoose.model('VenueNote', schema);
