import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import { kitchenReportPosition } from './eventStaffAccess.js';
import { serializeStaffEvent, staffScheduleQuery } from './staffPortal.js';
import { resolveEventSalesRep } from './eventReportSalesRep.js';
import { createApiError } from './apiErrors.js';
import { requiresEventReport } from './eventReportRequirement.js';

export const kitchenReportEventQuery = (nowstaEventId) => ({
  'meta.nowsta.apiEventId': nowstaEventId,
  status: { $not: /^(?:deleted|cancelled|canceled|lost)$/i },
  $or: [{ 'meta.nowsta.excluded': { $ne: true } }, { 'meta.eventReportTest': true }],
});

export const openStaffKitchenReport = async (user, nowstaEventId) => {
  if (String(user?.role || '').trim().toLowerCase() !== 'event staff') throw createApiError(403, 'Event Staff account required');
  const entry = await NowstaScheduleEntry.findOne({ ...staffScheduleQuery(user), nowstaEventId })
    .select('nowstaEventId title date shifts archived').lean();
  const assignedEvent = serializeStaffEvent(entry, user);
  if (!assignedEvent) throw createApiError(404, 'Event is not assigned to you');
  if (!assignedEvent.reportRequired) throw createApiError(403, 'No report is required for this event');
  if (!assignedEvent.canUseKitchenReport) throw createApiError(403, 'Lead Chef assignment or Executive Chef profile required');
  const event = await Event.findOne(kitchenReportEventQuery(nowstaEventId))
    .select('_id title date managerId meta catereaseOperations').lean();
  if (!event) throw createApiError(409, 'This Nowsta event is not linked to an active Inventory event. Ask an administrator to check the event sync.');
  if (!requiresEventReport(event)) throw createApiError(403, 'No report is required for this event');
  const subjectId = `account:${user.userId}:kitchen`;
  const email = String(user.email || '').trim().toLowerCase();
  // Reuse a Kitchen Report already requested through Slack for this same chef.
  const existing = await EventReport.findOne({ eventId: event._id, reportType: 'kitchen', $or: [
    { slackUserId: subjectId }, ...(email ? [{ reporterEmail: email }] : []),
  ] }).sort({ submittedAt: -1, createdAt: 1 });
  const report = existing || await EventReport.findOneAndUpdate(
    { eventId: event._id, slackUserId: subjectId },
    { $setOnInsert: {
      eventId: event._id, nowstaEventId,
      eventTitle: event.title || entry.title, eventDate: event.date || entry.date,
      reportType: 'kitchen', slackUserId: subjectId,
      reporterName: user.nowstaName || user.username, reporterEmail: email,
      position: kitchenReportPosition(user, assignedEvent.shifts), salesRep: resolveEventSalesRep(event), status: 'pending',
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { event, report };
};

// Portal links remain tied to the chef's current account and assignment after issuance.
export const validateStaffKitchenReportAccess = async (access, report) => {
  if (!String(access.context || '').startsWith('staff-kitchen:')) return;
  const userId = access.context.slice('staff-kitchen:'.length);
  if (!/^[a-f\d]{24}$/i.test(userId) || report.reportType !== 'kitchen') throw createApiError(403, 'Kitchen report access is no longer available');
  const user = await User.findById(userId).select('_id username email nowstaName role jobTitle isActive').lean();
  if (!user || user.isActive === false || String(user.role || '').trim().toLowerCase() !== 'event staff') throw createApiError(403, 'Kitchen report access is no longer available');
  const linkedEvent = await Event.findById(report.eventId).select('meta.nowsta.apiEventId').lean();
  const nowstaEventId = String(linkedEvent?.meta?.nowsta?.apiEventId || '');
  if (!nowstaEventId) throw createApiError(403, 'Event assignment is no longer available');
  const [event, entry] = await Promise.all([
    Event.findOne({ _id: report.eventId, ...kitchenReportEventQuery(nowstaEventId) }).select('_id').lean(),
    NowstaScheduleEntry.findOne({ ...staffScheduleQuery(user), nowstaEventId }).select('nowstaEventId title shifts archived').lean(),
  ]);
  const assignedEvent = serializeStaffEvent(entry, user);
  if (!event || !assignedEvent) throw createApiError(403, 'Event is no longer assigned to you');
  if (!assignedEvent.canUseKitchenReport) throw createApiError(403, 'Kitchen report access is no longer available');
};
