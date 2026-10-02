import { Router } from 'express';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import Product from '../models/Product.js';
import Event from '../models/Event.js';
import { requireRoles } from '../middleware/auth.js';
import { canReadStaffInventory, KITCHEN_PORTAL_ROLES } from '../utils/eventStaffAccess.js';
import { serializeStaffEvent, staffScheduleQuery } from '../utils/staffPortal.js';
import { sendApiError } from '../utils/apiErrors.js';
import { openStaffKitchenReport } from '../utils/staffKitchenReport.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';
import { dashboardEventGuestCount, EVENT_GUEST_COUNT_FIELDS } from '../utils/barGuestCount.js';
import { buildActiveDashboardBarEventQuery } from '../utils/barDashboardSync.js';
import { requiresEventReport } from '../utils/eventReportRequirement.js';

const router = Router();
const eventFields = 'nowstaEventId title client date venue address guestCount timeZone shifts archived';
const requireEventStaff = requireRoles(KITCHEN_PORTAL_ROLES);

const withLinkedEventDetails = async (items) => {
  if (!items.length) return items;
  const events = await Event.find({
    ...buildActiveDashboardBarEventQuery(),
    'meta.nowsta.apiEventId': { $in: items.map((item) => item.id) },
  }).select(['title', 'meta.nowsta.apiEventId', ...EVENT_GUEST_COUNT_FIELDS].join(' ')).lean();
  const counts = new Map();
  const exemptIds = new Set();
  for (const event of events) {
    const id = String(event.meta?.nowsta?.apiEventId);
    if (!requiresEventReport(event)) exemptIds.add(id);
    const count = dashboardEventGuestCount(event);
    if (count > 0 || !counts.has(id)) counts.set(id, count);
  }
  return items.map((item) => {
    const linkedCount = counts.get(item.id);
    const reportRequired = item.reportRequired && !exemptIds.has(item.id);
    return { ...item, guestCount: linkedCount > 0 ? linkedCount : item.guestCount ?? linkedCount ?? null,
      reportRequired, canUseKitchenReport: reportRequired && item.canUseKitchenReport };
  });
};

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
    const items = await withLinkedEventDetails(entries.map((entry) => serializeStaffEvent(entry, req.auth)).filter(Boolean));
    return res.json({ items, from, to });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load your events' }); }
});

router.get('/events/:id', requireEventStaff, async (req, res) => {
  try {
    const entry = await NowstaScheduleEntry.findOne({ ...staffScheduleQuery(req.auth), nowstaEventId: String(req.params.id) })
      .select(eventFields).lean();
    const event = serializeStaffEvent(entry, req.auth);
    if (!event) return res.status(404).json({ message: 'Event is not assigned to you' });
    const [enrichedEvent] = await withLinkedEventDetails([event]);
    return res.json(enrichedEvent);
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
