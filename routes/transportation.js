import { Router } from 'express';
import TransportationSchedule from '../models/TransportationSchedule.js';
import { normalizeTransportationRoutes } from '../utils/transportationSchedule.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    return res.json(schedule);
  } catch (error) {
    return sendApiError(res, error, { context: 'Transportation schedule update failed', fallbackMessage: 'Unable to save transportation schedule' });
  }
});

export default router;
