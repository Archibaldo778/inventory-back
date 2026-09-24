import { Router } from 'express';
import Event from '../models/Event.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { runSlackEventChannelSync, slackEventChannelsEnabled } from '../utils/slackEventChannels.js';
import { listSlackUsers, slackAuthTest } from '../utils/slackApi.js';

const router = Router();

router.get('/status', requireAuth, async (_req, res) => {
  const configured = Boolean(String(process.env.SLACK_BOT_TOKEN || '').trim());
  if (!configured) return res.json({ configured: false, connected: false });
  try {
    const identity = await slackAuthTest();
    const linkedEvents = await Event.countDocuments({ 'meta.slack.channelId': { $exists: true, $ne: '' } });
    return res.json({
      configured: true,
      connected: true,
      enabled: slackEventChannelsEnabled(),
      team: String(identity?.team || ''),
      botUserId: String(identity?.user_id || ''),
      linkedEvents,
    });
  } catch (error) {
    return res.status(502).json({ configured: true, connected: false, error: error?.message || 'Slack connection failed' });
  }
});

router.post('/sync', requireAuth, requireAdmin, async (_req, res) => {
  try {
    return res.json(await runSlackEventChannelSync());
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Slack event channel sync failed' });
  }
});

router.post('/events/:eventId/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    return res.json(await runSlackEventChannelSync({ eventId: req.params.eventId, force: true }));
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Slack event channel sync failed' });
  }
});

router.get('/people', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [slackUsers, schedules] = await Promise.all([
      listSlackUsers(),
      NowstaScheduleEntry.find({ 'shifts.workers.companyUserId': { $exists: true, $ne: '' } })
        .select('shifts.workers').sort({ date: -1 }).limit(5000).lean(),
    ]);
    const nowstaById = new Map();
    schedules.forEach((schedule) => (schedule.shifts || []).forEach((shift) => (shift.workers || []).forEach((worker) => {
      const id = String(worker?.companyUserId || '').trim();
      if (!id || nowstaById.has(id)) return;
      nowstaById.set(id, {
        id,
        name: String(worker?.name || '').trim(),
        email: String(worker?.email || '').trim().toLowerCase(),
      });
    })));
    return res.json({
      nowsta: [...nowstaById.values()].sort((a, b) => a.name.localeCompare(b.name)),
      slack: slackUsers
        .filter((user) => !user?.deleted && !user?.is_bot && user?.id !== 'USLACKBOT')
        .map((user) => ({
          id: String(user.id || ''),
          name: String(user?.profile?.real_name || user?.real_name || user?.name || '').trim(),
          email: String(user?.profile?.email || '').trim().toLowerCase(),
        }))
        .filter((user) => user.id && user.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Could not load Slack and Nowsta people' });
  }
});

export default router;
