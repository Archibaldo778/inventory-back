import { Router } from 'express';
import Event from '../models/Event.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { runSlackEventChannelSync, slackEventChannelsEnabled } from '../utils/slackEventChannels.js';
import { slackAuthTest } from '../utils/slackApi.js';

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

export default router;
