import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportReminder from '../models/EventReportReminder.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import User from '../models/Users.js';
import { captainAssignedShifts, isCaptainPosition } from './captainEventDuties.js';
import { buildActiveDashboardBarEventQuery } from './barDashboardSync.js';
import { captainReportIdentity, openCaptainReport } from './captainReports.js';
import { eventReportUrl } from './slackEventChannels.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { requiresEventReport } from './eventReportRequirement.js';

const HOUR = 60 * 60 * 1000;
// Incident hold: automatic delivery must remain off until explicitly re-enabled
// after the historical-mail incident has been reviewed.
export const CAPTAIN_REPORT_EMAIL_REMINDERS_ENABLED = false;
// Fixed rollout date in New York. Never move this forward with the current day.
export const CAPTAIN_REPORT_REMINDERS_START_DATE = '2026-10-01';
const reminderEventEligible = (date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
  && date >= CAPTAIN_REPORT_REMINDERS_START_DATE;
const clean = (value) => String(value || '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const captainReportReminderStage = (endsAt, now = new Date()) => {
  if (!endsAt) return null;
  const elapsed = new Date(now).getTime() - new Date(endsAt).getTime();
  return [48, 36, 24].find((hours) => elapsed >= hours * HOUR) || null;
};

export const assignedReportCaptains = (schedule, users) => users.filter((user) => (
  user.isActive !== false && ['captain', 'bar captain'].includes(user.role)
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email || '')
  && captainAssignedShifts(schedule, user).some((shift) => isCaptainPosition(shift.position))
));

export const captainReminderEmail = ({ event, user, report, endsAt, hours }) => {
  const dueAt = new Date(new Date(endsAt).getTime() + 48 * HOUR);
  const deadline = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short',
  }).format(dueAt);
  const url = eventReportUrl(event, report.slackUserId, endsAt);
  const instruction = hours === 48
    ? 'The 48-hour deadline for your Captain’s Report has been reached. Please submit it as soon as possible.'
    : 'Please complete your Captain’s Report by the deadline below.';
  const text = `Hi ${user.username || user.nowstaName || 'Captain'},\n\n${instruction}\n\nEvent: ${event.title}\nEvent date: ${event.date}\nDeadline: ${deadline} (New York time)\n\nReports must be submitted no later than 48 hours after the event ends.\n\nComplete your report: ${url}\n\nIf you need help, reply to this email.\n\nStaffing and Service Department`;
  return {
    from: clean(process.env.EVENT_REPORT_REMINDER_FROM) || 'Staffing and Service Department <reports@reports.occdecks.com>',
    reply_to: clean(process.env.EVENT_REPORT_REMINDER_REPLY_TO) || 'staffing@ocnyc.com',
    to: [clean(user.email).toLowerCase()],
    subject: `${hours === 48 ? 'Final reminder' : 'Reminder'}: Captain’s Report · ${event.title}`,
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172129"><h2>Captain’s Report</h2><p>Hi ${escapeHtml(user.username || user.nowstaName || 'Captain')},</p><p>${escapeHtml(instruction)}</p><p><strong>${escapeHtml(event.title)}</strong><br>${escapeHtml(event.date)}</p><p>Reports must be submitted no later than <strong>48 hours after the event ends</strong>.<br>Deadline: <strong>${escapeHtml(deadline)} (New York time)</strong></p><p><a href="${escapeHtml(url)}">Complete your report</a></p><p>If you need help, reply to this email.</p><p>Staffing and Service Department</p></div>`,
  };
};

export const deliverCaptainReportReminder = async ({ event, schedule, user, report, hours, now, fetchImpl, enabled = CAPTAIN_REPORT_EMAIL_REMINDERS_ENABLED }) => {
  if (!enabled) return 'skipped';
  if (!assignedReportCaptains(schedule, [user]).length) return 'skipped';
  if (!requiresEventReport(event, schedule)) return 'skipped';
  if (!reminderEventEligible(event.date) || !reminderEventEligible(schedule.date)) return 'skipped';
  const id = `captain-report:${event._id}:${user._id}:${hours}`;
  const existing = await EventReportReminder.findById(id).select('status firstAttemptAt lockedUntil').lean();
  if (existing && (['sent', 'cancelled'].includes(existing.status)
    || existing.firstAttemptAt <= new Date(now.getTime() - 23 * HOUR)
    || existing.lockedUntil > now)) return 'skipped';
  if (!existing) {
    try {
      await EventReportReminder.updateOne({ _id: id }, { $setOnInsert: {
        reportId: report._id, status: 'pending', firstAttemptAt: now,
        payload: captainReminderEmail({ event, user, report, endsAt: schedule.endsAt, hours }),
      } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  // Resend keeps idempotency keys for 24 hours. Reuse the saved payload, and
  // never retry an uncertain delivery beyond that window.
  const delivery = await EventReportReminder.findOneAndUpdate({
    _id: id, status: { $in: ['pending', 'failed'] },
    firstAttemptAt: { $gt: new Date(now.getTime() - 23 * HOUR) },
    $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
  }, { $set: { lockedUntil: new Date(now.getTime() + 2 * 60_000) } }, { new: true });
  if (!delivery) return 'skipped';
  // Submission through either the email link, portal or Slack stops reminders.
  if (await EventReport.exists({ ...captainReportIdentity(event._id, user), status: 'submitted' })) {
    await EventReportReminder.updateOne({ _id: id }, { $set: { status: 'cancelled', lockedUntil: null } });
    return 'skipped';
  }
  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': id },
      body: JSON.stringify(delivery.payload),
    }, { fetchImpl, timeoutMs: 20_000 });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id) throw new Error(payload.message || `Resend HTTP ${response.status}`);
    await EventReportReminder.updateOne({ _id: id }, { $set: { status: 'sent', sentAt: now, providerId: payload.id, lockedUntil: null, error: '' } });
  } catch (error) {
    await EventReportReminder.updateOne({ _id: id, status: { $ne: 'sent' } }, { $set: {
      status: 'failed', error: clean(error.message).slice(0, 1000), lockedUntil: new Date(now.getTime() + 5 * 60_000),
    } });
    return 'failed';
  }
  await EventReport.updateOne({ _id: report._id, status: 'pending' }, {
    $inc: { reminderCount: 1 }, $set: { lastReminderAt: now, eventEndsAt: schedule.endsAt },
  });
  return 'sent';
};

let running = false;
export const runCaptainReportEmailReminders = async ({ now = new Date(), fetchImpl = globalThis.fetch, enabled = CAPTAIN_REPORT_EMAIL_REMINDERS_ENABLED } = {}) => {
  const summary = { configured: Boolean(clean(process.env.RESEND_API_KEY)), sent: 0, failed: 0, skipped: 0 };
  if (!enabled) return { ...summary, disabled: true };
  if (!summary.configured || running) return summary;
  running = true;
  try {
    // Match the portal's 14-day history. After downtime, send only the latest
    // due stage, not a burst of all missed reminders.
    const schedules = await NowstaScheduleEntry.find({
      date: { $gte: CAPTAIN_REPORT_REMINDERS_START_DATE },
      archived: { $ne: true }, endsAt: { $gte: new Date(now.getTime() - 14 * 24 * HOUR), $lte: new Date(now.getTime() - 24 * HOUR) },
    }).select('nowstaEventId title date endsAt archived shifts').lean();
    if (!schedules.length) return summary;
    const [events, users] = await Promise.all([
      Event.find({ ...buildActiveDashboardBarEventQuery(), date: { $gte: CAPTAIN_REPORT_REMINDERS_START_DATE }, 'meta.eventReportTest': { $ne: true }, 'meta.nowsta.apiEventId': { $in: schedules.map((row) => row.nowstaEventId) } })
        .select('_id title date managerId meta catereaseOperations.salesRep').lean(),
      User.find({ role: { $in: ['captain', 'bar captain'] }, isActive: { $ne: false } }).select('_id username nowstaName email role isActive').lean(),
    ]);
    for (const schedule of schedules) {
      const matches = events.filter((event) => String(event.meta?.nowsta?.apiEventId) === schedule.nowstaEventId);
      if (matches.length !== 1) continue;
      const event = matches[0];
      if (!requiresEventReport(event, schedule)) continue;
      if (!reminderEventEligible(event.date) || !reminderEventEligible(schedule.date)) continue;
      const hours = captainReportReminderStage(schedule.endsAt, now);
      if (!hours || schedule.archived) continue;
      for (const user of assignedReportCaptains(schedule, users)) {
        try {
          const report = await openCaptainReport({ event, user, schedule });
          if (report.status === 'submitted') { summary.skipped += 1; continue; }
          summary[await deliverCaptainReportReminder({ event, schedule, user, report, hours, now, fetchImpl, enabled })] += 1;
        } catch (error) {
          summary.failed += 1;
          console.error('Captain report reminder failed:', clean(error.message).slice(0, 300));
        }
      }
    }
    return summary;
  } finally { running = false; }
};
