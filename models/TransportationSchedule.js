import mongoose from 'mongoose';

const transportationRouteSchema = new mongoose.Schema({
  eventId: { type: String, default: '', trim: true },
  eventTitle: { type: String, default: '', trim: true },
  eventNumber: { type: String, default: '', trim: true },
  eventVenue: { type: String, default: '', trim: true },
  deliveryRequired: { type: Boolean, default: true },
  taskType: { type: String, enum: ['delivery', 'pickup', 'return', 'other'], default: 'delivery' },
  cargoType: { type: String, default: '', trim: true },
  driverSource: { type: String, enum: ['', 'staff', 'operations', 'nowsta'], default: '' },
  driverId: { type: String, default: '', trim: true },
  driverName: { type: String, default: '', trim: true },
  driverEmail: { type: String, default: '', trim: true, lowercase: true },
  driverPhone: { type: String, default: '', trim: true },
  vehicle: { type: String, default: '', trim: true },
  callTime: { type: String, default: '', trim: true },
  departureTime: { type: String, default: '', trim: true },
  onSiteTime: { type: String, default: '', trim: true },
  pickupTime: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true },
  status: { type: String, enum: ['not_required', 'unassigned', 'assigned', 'complete'], default: 'unassigned' },
  sortOrder: { type: Number, default: 0, min: 0 },
}, { _id: true });

const transportationScheduleSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, trim: true, index: true },
  routes: { type: [transportationRouteSchema], default: [] },
  publishedAt: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('TransportationSchedule', transportationScheduleSchema);
