import mongoose from 'mongoose';

const transportationVehicleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, unique: true, trim: true, index: true },
  active: { type: Boolean, default: true },
  lastUsedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const transportationVenueSchema = new mongoose.Schema({
  venueName: { type: String, required: true, trim: true },
  normalizedVenueName: { type: String, required: true, unique: true, trim: true, index: true },
  serviceAddress: { type: String, required: true, trim: true },
}, { timestamps: true });

export const TransportationVehicle = mongoose.model('TransportationVehicle', transportationVehicleSchema);
export const TransportationVenue = mongoose.model('TransportationVenue', transportationVenueSchema);
