import { Router } from 'express';
import TransportationSchedule from '../models/TransportationSchedule.js';
import { TransportationVehicle, TransportationVenue } from '../models/TransportationResource.js';
import { normalizeTransportationRoutes } from '../utils/transportationSchedule.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value, maxLength = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const normalized = (value) => clean(value).toLowerCase();

router.get('/resources', async (_req, res) => {
  try {
    const [vehicles, venues] = await Promise.all([
      TransportationVehicle.find({ active: true }).sort({ lastUsedAt: -1, name: 1 }).lean(),
      TransportationVenue.find({}).sort({ venueName: 1 }).lean(),
    ]);
    return res.json({ vehicles, venues });
  } catch (error) {
    return sendApiError(res, error, { context: 'Transportation resources lookup failed', fallbackMessage: 'Unable to load transportation resources' });
  }
});

router.put('/venues/address', async (req, res) => {
  try {
    const venueName = clean(req.body?.venueName, 300);
    const serviceAddress = clean(req.body?.serviceAddress, 600);
    if (!venueName || !serviceAddress) return res.status(400).json({ message: 'Venue and service address are required' });
    const venue = await TransportationVenue.findOneAndUpdate(
      { normalizedVenueName: normalized(venueName) },
      { $set: { venueName, normalizedVenueName: normalized(venueName), serviceAddress } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json(venue);
  } catch (error) {
    return sendApiError(res, error, { context: 'Transportation venue update failed', fallbackMessage: 'Unable to save service address' });
  }
});

router.get('/:date', async (req, res) => {
  try {
    const date = String(req.params.date || '').trim();
    if (!DATE_PATTERN.test(date)) return res.status(400).json({ message: 'A valid transportation date is required' });
    const schedule = await TransportationSchedule.findOne({ date }).lean();
    return res.json(schedule || { date, routes: [], publishedAt: null, updatedAt: null });
  } catch (error) {
    return sendApiError(res, error, { context: 'Transportation schedule lookup failed', fallbackMessage: 'Unable to load transportation schedule' });
  }
});

router.put('/:date', async (req, res) => {
  try {
    const date = String(req.params.date || '').trim();
    if (!DATE_PATTERN.test(date)) return res.status(400).json({ message: 'A valid transportation date is required' });
    const routes = normalizeTransportationRoutes(req.body?.routes);
    if (routes.some((route) => !route.eventTitle)) {
      return res.status(400).json({ message: 'Every transportation route needs an event name' });
    }
    const schedule = await TransportationSchedule.findOneAndUpdate(
      { date },
      { $set: { routes, updatedBy: req.auth?.userId || null } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    const vehicles = [...new Set(routes.map((route) => clean(route.vehicle, 160)).filter(Boolean))];
    if (vehicles.length) {
      await TransportationVehicle.bulkWrite(vehicles.map((name) => ({
        updateOne: {
          filter: { normalizedName: normalized(name) },
          update: { $set: { name, normalizedName: normalized(name), active: true, lastUsedAt: new Date() } },
          upsert: true,
        },
      })), { ordered: false });
    }
    return res.json(schedule);
  } catch (error) {
    return sendApiError(res, error, { context: 'Transportation schedule update failed', fallbackMessage: 'Unable to save transportation schedule' });
  }
});

export default router;
