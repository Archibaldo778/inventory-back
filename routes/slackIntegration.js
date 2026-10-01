import { Router } from 'express';
import Event from '../models/Event.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import Staff from '../models/Staff.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import EventReport from '../models/EventReport.js';
import { captainBarUrl, eventReportUrl, matchSlackBarReturnRecipients, matchSlackCaptainReporters, runSlackEventChannelSync, slackEventChannelsEnabled } from '../utils/slackEventChannels.js';
import { listSlackUsers, postSlackMessage, slackAuthTest } from '../utils/slackApi.js';
import { createNowstaClient } from '../utils/nowstaApi.js';
import { buildSlackPeopleAudit } from '../utils/slackPeopleAudit.js';

const router = Router();
const clean = (value) => String(value || '').trim();

const loadReportLinkPlan = async (eventId, { includeBarReturns = false, copyEmails = [] } = {}) => {
  const event = await Event.findById(eventId).lean();
  if (!event) throw Object.assign(new Error('Event was not found'), { statusCode: 404 });
  const conditions = [
    ...(clean(event?.meta?.nowsta?.apiEventId) ? [{ nowstaEventId: clean(event.meta.nowsta.apiEventId) }] : []),
    ...(clean(event.externalId) ? [{ externalId: clean(event.externalId) }] : []),
  ];
  if (!conditions.length) throw Object.assign(new Error('This event is not linked to Nowsta'), { statusCode: 409 });
  const [schedule, slackUsers, linkedStaff] = await Promise.all([
    NowstaScheduleEntry.findOne({ $or: conditions }).lean(),
    listSlackUsers(),
    Staff.find({ nowstaCompanyUserId: { $ne: '' }, slackUserId: { $ne: '' }, active: { $ne: false } }).select('nowstaCompanyUserId slackUserId').lean(),
  ]);
  if (!schedule) throw Object.assign(new Error('No matching Nowsta schedule was found'), { statusCode: 409 });
  const linked = new Map(linkedStaff.map((person) => [clean(person.nowstaCompanyUserId), clean(person.slackUserId)]));
  const reportRecipients = matchSlackCaptainReporters({ schedules: [schedule], slackUsers, linkedSlackByNowstaId: linked });
  const barRecipients = includeBarReturns
    ? matchSlackBarReturnRecipients({ schedules: [schedule], slackUsers, linkedSlackByNowstaId: linked })
    : { matched: [], unmatched: [] };
  const copies = [...new Set(copyEmails.map((value) => clean(value).toLowerCase()).filter(Boolean))].map((email) => ({
    email,
    user: slackUsers.find((user) => clean(user?.profile?.email).toLowerCase() === email) || null,
  }));
  return { event, schedule, reportRecipients, barRecipients, copies };
};

const publicLinkPlan = (plan) => ({
  event: { id: String(plan.event._id), title: plan.event.title, date: plan.event.date },
  captainReports: plan.reportRecipients.matched.map((person) => ({ slackUserId: person.id, name: person.name, email: person.email, position: person.position })),
  barReturns: plan.barRecipients.matched.map((person) => ({ slackUserId: person.id, name: person.name, email: person.email, position: person.position })),
  copies: plan.copies.map(({ email, user }) => ({ email, slackUserId: clean(user?.id), name: clean(user?.profile?.real_name || user?.real_name || user?.name), matched: Boolean(user) })),
  unmatched: [...plan.reportRecipients.unmatched, ...plan.barRecipients.unmatched],
});

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

router.post('/events/:eventId/report-links/preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const plan = await loadReportLinkPlan(req.params.eventId, {
      includeBarReturns: req.body?.includeBarReturns === true,
      copyEmails: Array.isArray(req.body?.copyEmails) ? req.body.copyEmails : [],
    });
    return res.json(publicLinkPlan(plan));
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Could not preview Slack report links' });
  }
});

router.post('/events/:eventId/report-links/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Preview and confirm recipients before sending' });
    const plan = await loadReportLinkPlan(req.params.eventId, {
      includeBarReturns: req.body?.includeBarReturns === true,
      copyEmails: Array.isArray(req.body?.copyEmails) ? req.body.copyEmails : [],
    });
    const sent = [];
    for (const captain of plan.reportRecipients.matched) {
      const report = await EventReport.findOneAndUpdate(
        { eventId: plan.event._id, slackUserId: captain.id },
        { $set: { eventTitle: plan.event.title, eventDate: plan.event.date, reporterName: captain.name, reporterEmail: captain.email, position: captain.position, slackRecipientId: captain.id }, $setOnInsert: { nowstaEventId: plan.schedule.nowstaEventId, eventEndsAt: plan.schedule.endsAt, status: 'pending' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const url = eventReportUrl(plan.event, captain.id, plan.schedule.endsAt || plan.event.date);
      await postSlackMessage({ channel: captain.id, text: `Captain's Report for ${plan.event.title}: ${url}` });
      report.requestSentAt = new Date(); await report.save();
      sent.push({ type: 'captain_report', recipient: captain.name, url });
    }
    const barLinks = [];
    for (const captain of plan.barRecipients.matched) {
      const url = captainBarUrl(plan.event, [plan.event], plan.schedule.date, captain.email);
      await postSlackMessage({ channel: captain.id, text: `Bar Returns for ${plan.event.title}: ${url}` });
      barLinks.push({ type: 'bar_returns', recipient: captain.name, url });
    }
    for (const { email, user } of plan.copies) {
      if (!user?.id) continue;
      const lines = [...sent, ...barLinks].map((entry) => `${entry.type === 'captain_report' ? "Captain's Report" : 'Bar Returns'} · ${entry.recipient}: ${entry.url}`);
      if (lines.length) await postSlackMessage({ channel: user.id, text: `Copies for ${plan.event.title}\n${lines.join('\n')}` });
    }
    return res.json({ ok: true, sent: [...sent, ...barLinks].length, preview: publicLinkPlan(plan) });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Could not send Slack report links' });
  }
});

router.get('/people/audit', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const nowstaClient = createNowstaClient();
    const [slackUsers, nowstaUsers, linkedStaff] = await Promise.all([
      listSlackUsers(),
      nowstaClient.listAll('/v2/company_users', { include_archived: false }),
      Staff.find({ nowstaCompanyUserId: { $ne: '' }, slackUserId: { $ne: '' } })
        .select('nowstaCompanyUserId slackUserId').lean(),
    ]);
    return res.json(buildSlackPeopleAudit({ nowstaUsers, slackUsers, linkedStaff }));
  } catch (error) {
    return res.status(Number(error?.statusCode) || 502).json({ error: error?.message || 'Could not audit Slack and Nowsta people' });
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
