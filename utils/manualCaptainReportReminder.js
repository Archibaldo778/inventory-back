import Event from '../models/Event.js';
import { loadReportRequestContext } from './eventReportRequests.js';
import { canManuallyRemindCaptain, deliverCaptainReportReminder } from './captainReportReminders.js';
import { openCaptainReport } from './captainReports.js';
import { createApiError } from './apiErrors.js';

export const sendManualCaptainReminder = async ({ eventId, userId, requestId, actor, now = new Date(), fetchImpl = globalThis.fetch }) => {
  const event = await Event.findById(eventId).select('title date status meta managerId catereaseOperations').lean();
  if (!event) throw createApiError(404, 'Event not found');
  const { schedule, users } = await loadReportRequestContext(event);
  const user = users.find((candidate) => String(candidate._id) === userId);
  if (!canManuallyRemindCaptain({ event, schedule, user, now })) throw createApiError(409, 'Reminders are available after 36 hours only for required reports and current Captain bookings');
  const report = await openCaptainReport({ event, schedule, user });
  if (!canManuallyRemindCaptain({ event, schedule, user, report, now })) throw createApiError(409, 'This report is already submitted or cancelled');
  const status = await deliverCaptainReportReminder({ event, schedule, user, report, hours: 36, manualRequestId: requestId, actor, now, fetchImpl });
  if (status === 'failed') throw createApiError(502, 'Reminder delivery failed. Try again.');
  if (status === 'skipped') throw createApiError(409, 'Reminder is already processing or no longer required. Refresh the event.');
  return { status };
};
