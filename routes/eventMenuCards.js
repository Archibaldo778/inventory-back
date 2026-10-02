import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import EventMenuCard from '../models/EventMenuCard.js';
import { requireWorkspaceEditor } from '../middleware/auth.js';
import { sendApiError } from '../utils/apiErrors.js';
import { normalizeMenuCard, menuCardRevision } from '../utils/eventMenuCards.js';

const router = Router({ mergeParams: true });
router.use(requireWorkspaceEditor);
router.use(async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.eventId)) return res.status(400).json({ message: 'Invalid event' });
    const event = await Event.findById(req.params.eventId).select('title date status').lean();
    if (!event || /^deleted$/i.test(event.status || '')) return res.status(404).json({ message: 'Event not found' });
    req.menuEvent = event;
    return next();
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load event' }); }
});

router.get('/', async (req, res) => {
  try {
    const cards = await EventMenuCard.find({ eventId: req.params.eventId }).sort({ createdAt: 1 }).lean();
    return res.json({ event: req.menuEvent, cards });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load menu cards' }); }
});

router.post('/', async (req, res) => {
  try {
    const card = await EventMenuCard.create({ ...normalizeMenuCard(req.body), eventId: req.params.eventId,
      updatedBy: String(req.auth?.userId || ''), revision: 0 });
    return res.status(201).json({ card });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not create menu card' }); }
});

router.patch('/:cardId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.cardId)) return res.status(400).json({ message: 'Invalid menu card' });
    const expectedRevision = menuCardRevision(req.body?.expectedRevision);
    const card = await EventMenuCard.findOneAndUpdate({ _id: req.params.cardId, eventId: req.params.eventId, revision: expectedRevision }, {
      $set: { ...normalizeMenuCard(req.body), updatedBy: String(req.auth?.userId || '') }, $inc: { revision: 1 },
    }, { new: true, runValidators: true });
    if (!card) return res.status(409).json({ message: 'This card was changed by someone else. Reload the saved card or save your work as a new card.' });
    return res.json({ card });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not save menu card' }); }
});

export default router;
