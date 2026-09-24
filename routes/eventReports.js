import { Router } from 'express';
import EventReport from '../models/EventReport.js';
import EventReportSettings from '../models/EventReportSettings.js';
import { listSlackUsers } from '../utils/slackApi.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query?.eventId) filter.eventId = clean(req.query.eventId, 80);
    if (req.query?.status) filter.status = clean(req.query.status, 40);
    const reports = await EventReport.find(filter).sort({ eventDate: -1, reporterName: 1 }).limit(1000).lean();
    return res.json({ items: reports });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event reports list failed', fallbackMessage: 'Could not load event reports' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    const [settings, slackUsers] = await Promise.all([
      EventReportSettings.findOne({ key: 'default' }).lean(),
      listSlackUsers(),
    ]);
    const people = slackUsers.filter((user) => !user?.deleted && !user?.is_bot && user?.id !== 'USLACKBOT').map((user) => ({
      slackUserId: clean(user.id, 100),
      name: clean(user?.profile?.real_name || user?.real_name || user?.name, 200),
      email: clean(user?.profile?.email, 320).toLowerCase(),
    })).filter((user) => user.slackUserId && user.name && user.email).sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ settings: settings || { recipients: [], emailEnabled: false }, people });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report settings load failed', fallbackMessage: 'Could not load report settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const recipients = (Array.isArray(req.body?.recipients) ? req.body.recipients : []).slice(0, 100).map((recipient) => ({
      slackUserId: clean(recipient?.slackUserId, 100), name: clean(recipient?.name, 200), email: clean(recipient?.email, 320).toLowerCase(),
    })).filter((recipient) => recipient.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email));
    const settings = await EventReportSettings.findOneAndUpdate({ key: 'default' }, { $set: {
      recipients, emailEnabled: req.body?.emailEnabled === true,
      updatedBy: clean(req.auth?.email || req.auth?.username || req.auth?.userId, 200),
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    return res.json({ settings });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report settings save failed', fallbackMessage: 'Could not save report settings' });
  }
});

export default router;
