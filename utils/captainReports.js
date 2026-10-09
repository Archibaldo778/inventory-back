import EventReport from '../models/EventReport.js';
import { resolveEventSalesRep } from './eventReportSalesRep.js';
import { createApiError } from './apiErrors.js';
import { captainEventDuties } from './captainEventDuties.js';

export const captainReportIdentity = (eventId, user) => ({
  eventId, reportType: 'captain',
  $or: [
    { slackUserId: `account:${String(user.userId || user._id)}` },
    ...(user.email ? [{ reporterEmail: String(user.email).trim().toLowerCase() }] : []),
  ],
});

export const openCaptainReport = async ({ event, user, schedule, fallbackSalesRep = '' }) => {
  if (!['captain', 'bar captain'].includes(String(user?.role || '').trim().toLowerCase())) throw createApiError(403, 'Captain account required to create a personal report');
  if (!captainEventDuties({ event, user, schedule }).captainAssigned) throw createApiError(403, 'A confirmed Captain booking is required for this event');
  // Reuse Slack requests and submitted reports for the same person.
  const existing = await EventReport.findOne(captainReportIdentity(event._id, user))
    .sort({ submittedAt: -1, createdAt: 1 });
  if (existing) return existing;
  const subjectId = `account:${String(user.userId || user._id)}`;
  return EventReport.findOneAndUpdate(
    { eventId: event._id, slackUserId: subjectId },
    { $setOnInsert: {
      eventId: event._id, eventTitle: event.title, eventDate: event.date || schedule?.date || '',
      nowstaEventId: schedule?.nowstaEventId || event.meta?.nowsta?.apiEventId || '',
      eventEndsAt: schedule?.endsAt || null,
      reportType: 'captain', slackUserId: subjectId,
      reporterName: user.username || user.nowstaName || user.email || '',
      reporterEmail: String(user.email || '').trim().toLowerCase(),
      position: 'Captain', salesRep: resolveEventSalesRep(event, fallbackSalesRep), status: 'pending',
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};
