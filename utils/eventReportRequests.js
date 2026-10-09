import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import EventReport from '../models/EventReport.js';
import EventReportReminder from '../models/EventReportReminder.js';
import { captainAssignedShifts, isCaptainPosition } from './captainEventDuties.js';
import { captainReportIdentity } from './captainReports.js';
import { CAPTAIN_REPORT_REMINDERS_START_DATE } from './captainReportReminders.js';
import { requiresCaptainReport } from './eventReportRequirement.js';
import { createApiError } from './apiErrors.js';

const email = (value) => String(value || '').trim().toLowerCase();
const matchesUser = (report, user) => report.reportType === 'captain' && (
  report.slackUserId === `account:${user._id}` || (email(user.email) && email(report.reporterEmail) === email(user.email))
);
const positions = (schedule, user) => [...new Set(captainAssignedShifts(schedule, user).map((shift) => shift.position).filter(Boolean))];

export const loadReportRequestContext = async (event) => {
  const nowsta = event?.meta?.nowsta;
  if (!nowsta?.apiEventId && !nowsta?.shifts) return { schedule: null, users: [] };
  const [schedule, users] = await Promise.all([
    nowsta.apiEventId ? NowstaScheduleEntry.findOne({ nowstaEventId: String(nowsta.apiEventId) })
      .select('nowstaEventId title date endsAt archived shifts').lean() : null,
    User.find({ role: { $in: ['captain', 'bar captain'] } }).select('_id username nowstaName email role isActive').lean(),
  ]);
  // An unavailable live schedule must not fall back to stale assignments.
  return { schedule: nowsta.apiEventId ? schedule : nowsta, users };
};

export const buildEventReportRequests = ({ event, schedule, users, reports }) => {
  const items = reports.map((report) => {
    const user = users.find((candidate) => matchesUser(report, candidate))
      || { username: report.reporterName, email: report.reporterEmail };
    const disabled = report.reportType !== 'kitchen' && report.status === 'pending' && !requiresCaptainReport(event, schedule);
    return { ...report, ...(disabled ? { status: 'not_required', requirementReason: 'Captain’s Report is not required for this event.' } : {}), eventPosition: positions(schedule, user).join(' / '),
      canCancelRequest: !disabled && report.reportType !== 'kitchen' && report.status === 'pending' };
  });
  if (!event || /^(?:deleted|cancelled|canceled|lost)$/i.test(event.status || '') || event.meta?.nowsta?.excluded || schedule?.archived) return items;
  for (const user of users) {
    const assigned = positions(schedule, user);
    if (!assigned.length || reports.some((report) => matchesUser(report, user))) continue;
    let reason = '';
    if (!requiresCaptainReport(event, schedule)) reason = 'This event does not require a report.';
    else if (!assigned.some(isCaptainPosition)) reason = 'Not booked as a Captain on this event.';
    items.push({
      id: `planned:${user._id}`, userId: String(user._id), eventId: String(event._id),
      eventTitle: event.title, eventDate: event.date, reportType: 'captain',
      reporterName: user.username || user.nowstaName || user.email, reporterEmail: user.email,
      eventPosition: assigned.join(' / '), position: assigned.join(' / '),
      status: reason ? 'not_required' : 'pending', planned: true, requirementReason: reason,
      reminderNote: !reason && event.date < CAPTAIN_REPORT_REMINDERS_START_DATE
        ? 'Automatic reminders apply to events from October 1, 2026.' : '',
      canCancelRequest: !reason, reminderCount: 0, requestSentAt: null,
      emailDelivery: { status: 'not_sent' },
    });
  }
  return items;
};

export const cancelEventReportRequest = async ({ event, reportId, userId, actor }) => {
  let report;
  if (reportId) {
    report = await EventReport.findOne({ _id: reportId, eventId: event._id, reportType: 'captain' });
    if (!report) throw createApiError(404, 'Captain report request was not found');
  } else {
    const { schedule, users } = await loadReportRequestContext(event);
    const user = users.find((candidate) => String(candidate._id) === userId);
    if (!user || !positions(schedule, user).length) throw createApiError(409, 'This person is no longer booked on this event. Refresh the list.');
    report = await EventReport.findOne(captainReportIdentity(event._id, user)).sort({ submittedAt: -1, createdAt: 1 });
    if (!report) {
      // Persist only an explicit cancellation; viewing the list never creates requests.
      report = await EventReport.findOneAndUpdate({ eventId: event._id, slackUserId: `account:${user._id}` }, { $setOnInsert: {
        eventId: event._id, eventTitle: event.title, eventDate: event.date || '',
        nowstaEventId: schedule?.nowstaEventId || '', reportType: 'captain', slackUserId: `account:${user._id}`,
        reporterName: user.username || user.nowstaName || user.email, reporterEmail: email(user.email),
        position: positions(schedule, user).join(' / '), status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor,
      } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    }
  }
  if (report.status === 'submitted') throw createApiError(409, 'This report has already been submitted. Refresh the list.');
  if (report.status !== 'cancelled') {
    report = await EventReport.findOneAndUpdate({ _id: report._id, status: 'pending' }, {
      $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor, nextReminderAt: null },
    }, { new: true });
    if (!report) throw createApiError(409, 'The report changed. Refresh the list.');
  }
  await EventReportReminder.updateMany({ reportId: report._id, status: { $in: ['pending', 'failed'] } }, {
    $set: { status: 'cancelled', lockedUntil: null },
  });
  return report;
};
