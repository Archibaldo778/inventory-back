import { Router } from 'express';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import Product from '../models/Product.js';
import { requireRoles } from '../middleware/auth.js';
import { canReadStaffInventory } from '../utils/eventStaffAccess.js';
import { serializeStaffEvent, staffScheduleQuery } from '../utils/staffPortal.js';
import { sendApiError } from '../utils/apiErrors.js';
import { openStaffKitchenReport } from '../utils/staffKitchenReport.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';

const router = Router();
const eventFields = 'nowstaEventId title client date venue address guestCount timeZone shifts archived';
const requireEventStaff = requireRoles(['event staff']);

router.get('/events', requireEventStaff, async (req, res) => {
  try {
    const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = dateFormat.format(new Date());
    const from = String(req.query.from || today);
    const to = String(req.query.to || dateFormat.format(new Date(Date.now() + 90 * 86400000)));
    const allDates = req.query.view === 'all';
    if (![from, to].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)
      || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
      return res.status(400).json({ message: 'Choose a date range of up to one year' });
    }
    const entries = await NowstaScheduleEntry.find({ ...staffScheduleQuery(req.auth), ...(!allDates ? { date: { $gte: from, $lte: to } } : {}) })
      .select(eventFields).sort({ date: 1, startsAt: 1 }).lean();
    return res.json({ items: entries.map((entry) => serializeStaffEvent(entry, req.auth)).filter(Boolean), from, to });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load your events' }); }
});

router.get('/events/:id', requireEventStaff, async (req, res) => {
  try {
    const entry = await NowstaScheduleEntry.findOne({ ...staffScheduleQuery(req.auth), nowstaEventId: String(req.params.id) })
      .select(eventFields).lean();
    const event = serializeStaffEvent(entry, req.auth);
    if (!event) return res.status(404).json({ message: 'Event is not assigned to you' });
    return res.json(event);
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load your event' }); }
});

router.get('/inventory', async (req, res) => {
  if (!canReadStaffInventory(req.auth)) return res.status(403).json({ message: 'Inventory viewing permission required' });
  try {
    const items = await Product.find({}).select('name inventoryCode inventoryType quantity locations description category material color location sizes sizeOptions selectedSize sizeLabel sizeWidth sizeHeight sizeDepth image imageUrl images')
      .sort({ name: 1 }).lean();
    return res.json({ items });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load inventory' }); }
});

router.post('/events/:id/kitchen-report-link', requireEventStaff, async (req, res) => {
  try {
    const { event, report } = await openStaffKitchenReport(req.auth, String(req.params.id));
    const access = issueEventGuestAccess({
      eventIds: [String(event._id)], capability: 'event:report', subjectId: report.slackUserId,
      context: `staff-kitchen:${req.auth.userId}`,
      expiresAt: new Date(Date.now() + 120 * 86400000),
    });
    return res.json({ path: `/event-report/${event._id}?access=${encodeURIComponent(access)}` });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not open the Kitchen Report' }); }
});

export default router;
