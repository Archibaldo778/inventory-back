import crypto from 'node:crypto';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import VenueReportNotification from '../models/VenueReportNotification.js';
import { analyzeEventReports, eventReportAnalysisInput } from './eventReportAi.js';
import { loadReportTeamDirectory, resolveTeamRouting } from './reportTeams.js';
import { userInviteUrl } from './userInvitations.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { loadVenueKnowledgeReports, venueNotificationNotesCurrent } from './venueKnowledge.js';
import { eventVenue, normalizeVenuePart, usableVenueName } from './venues.js';
export { eventVenue } from './venues.js';

// October 6, 2026 at midnight in New York. This is a creation cutoff, not an event-date cutoff.
export const VENUE_REPORT_START = new Date('2026-10-06T04:00:00.000Z');
const clean = (value) => String(value || '').trim();
const normalize = normalizeVenuePart;
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const todayInNewYork = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const sameReportVenue = (first, second) => {
  const a = eventVenue(first); const b = eventVenue(second);
  const name = normalize(a.name);
  if (!usableVenueName(name)) return false;
  // Never fuzzy-match names or infer an address. Missing addresses remain pending.
  return name === normalize(b.name) && Boolean(normalize(a.address)) && normalize(a.address) === normalize(b.address);
};
export const venueNotificationEligible = (event, now = new Date()) => (
  Number.isFinite(+new Date(event?.createdAt)) && +new Date(event.createdAt) >= +VENUE_REPORT_START
  && +new Date(event.createdAt) <= +now && /^\d{4}-\d{2}-\d{2}$/.test(event?.date || '')
  && event.date >= todayInNewYork(now) && !/cancel|lost|declin|delete/i.test(event?.status || '')
);

export const supportedVenueNotes = (analysis, reports) => {
  const notes = [];
  for (const problem of analysis?.problems || []) {
    if (!clean(problem.title) || !clean(problem.detail)) continue;
    for (const report of reports) {
      const answers = eventReportAnalysisInput({ reports: [report] }).reports[0].answers.map((answer) => answer.answer);
      const quote = (problem.evidence || []).find((evidence) => clean(evidence).length >= 12 && answers.includes(clean(evidence)));
      if (quote) notes.push({ title: problem.title, recommendation: problem.detail, quote,
        reportId: String(report.sourceReportId || report._id), eventId: String(report.eventId), date: report.eventDate, reporter: report.reporterName,
        venueId: report.venueId, venueNoteId: report.venueNoteId, venueNoteRevision: report.venueNoteRevision, source: report.source });
    }
  }
  return notes.filter((note, index) => notes.findIndex((other) => other.reportId === note.reportId && other.quote === note.quote) === index);
};

export const venuePlanningEmail = ({ event, notes, recipients }) => {
  const venue = eventVenue(event);
  const link = (id) => new URL(`/events/${encodeURIComponent(String(id))}?view=reports`, userInviteUrl('')).href;
  const sourceLink = (note) => note.venueId
    ? new URL(`/admin-venues?venue=${encodeURIComponent(note.venueId)}&note=${encodeURIComponent(note.venueNoteId)}`, userInviteUrl('')).href : link(note.eventId);
  const heading = `Venue planning notes — ${venue.name} — ${event.date}`;
  const introduction = `A new event, ${event.title}, is scheduled at ${venue.name} (${venue.address}) on ${event.date}. Venue records and previous captain's reports noted the following constraints. These are historical observations; confirm current conditions before making arrangements.`;
  return {
    from: clean(process.env.EVENT_REPORT_FROM) || 'Staffing and Service Department <reports@reports.occdecks.com>',
    to: recipients, subject: heading,
    text: `${heading}\n\n${introduction}\n\n${notes.map((note) => `${note.title}\nReported: ${note.quote}\nPlanning recommendation: ${note.recommendation}\nSource: ${note.date}, ${note.reporter}, ${note.venueNoteId ? `venue note ${note.venueNoteId}` : `report ${note.reportId}`}\n${sourceLink(note)}`).join('\n\n')}\n\nUpcoming event: ${link(event._id)}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(introduction)}</p>${notes.map((note) => `<h3>${escapeHtml(note.title)}</h3><p><strong>Reported:</strong> ${escapeHtml(note.quote)}</p><p><strong>Planning recommendation:</strong> ${escapeHtml(note.recommendation)}</p><p>Source: ${escapeHtml(note.date)}, ${escapeHtml(note.reporter)} — <a href="${escapeHtml(sourceLink(note))}">View source</a></p>`).join('')}<p><a href="${escapeHtml(link(event._id))}">View upcoming event</a></p></div>`,
  };
};

export const loadVenueReports = async (event, { Events = Event, Reports = EventReport } = {}) => {
  const ids = await Reports.distinct('eventId', { status: 'submitted', reportType: 'captain', submittedAt: { $lte: event.createdAt } });
  const candidates = await Events.find({ _id: { $in: ids, $ne: event._id }, date: { $lt: event.date } })
    .select('_id date meta catereaseOperations').lean();
  const matched = candidates.filter((source) => sameReportVenue(event, source)).map((source) => source._id);
  if (!matched.length) return [];
  return Reports.find({ eventId: { $in: matched }, reportType: 'captain', status: 'submitted', submittedAt: { $lte: event.createdAt } })
    .sort({ eventDate: -1, _id: 1 }).lean();
};

export const processVenueNotification = async ({ event, now = new Date(), Jobs = VenueReportNotification,
  loadReports = loadVenueKnowledgeReports, loadTeams = loadReportTeamDirectory, analyze = analyzeEventReports,
  notesCurrent = venueNotificationNotesCurrent,
  fetchImpl = globalThis.fetch, apiKey = process.env.RESEND_API_KEY,
} = {}) => {
  if (!apiKey || !venueNotificationEligible(event, now)) return 'skipped';
  const startedAt = Date.now();
  const clock = () => new Date(+now + Date.now() - startedAt);
  const venue = eventVenue(event);
  const venueKey = `knowledge-v1|${normalize(venue.name)}|${normalize(venue.address)}`;
  try {
    await Jobs.updateOne({ _id: event._id }, { $setOnInsert: { status: 'waiting', nextAttemptAt: now } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  // A placeholder or corrected venue must not leave an unsent event permanently checked off.
  await Jobs.updateOne({ _id: event._id, status: 'no_notes', venueKey: { $ne: venueKey } }, {
    $set: { status: 'waiting', nextAttemptAt: now },
  });
  const token = crypto.randomUUID();
  const job = await Jobs.findOneAndUpdate({ _id: event._id, status: { $in: ['waiting', 'queued', 'processing'] },
    nextAttemptAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
  }, { $set: { lockToken: token, lockedUntil: new Date(+now + 15 * 60_000) } }, { new: true }).select('+payload');
  if (!job) return 'idle';
  const claim = { _id: event._id, lockToken: token };
  const save = (fields) => Jobs.updateOne(claim, { $set: fields });
  try {
    if (job.firstAttemptAt && +now - +new Date(job.firstAttemptAt) >= 23 * 3600_000) {
      await save({ status: 'expired', error: 'Delivery confirmation expired; do not automatically resend.', lockedUntil: null });
      return 'expired';
    }
    if (!job.payload) {
      if (!usableVenueName(venue.name) || !normalize(venue.address)) throw new Error('Waiting for venue name and address');
      const routing = resolveTeamRouting({ event, ...await loadTeams() });
      if (routing.status !== 'ready' || !routing.recipients.length) throw new Error('Waiting for an enabled Sales report team');
      const reports = await loadReports(event);
      const notes = [];
      // Keep each request within the established report analysis limits.
      for (let offset = 0; offset < reports.length; offset += 25) {
        const renewed = await save({ lockedUntil: new Date(+clock() + 15 * 60_000) });
        if (!renewed.matchedCount) return 'idle';
        const batch = reports.slice(offset, offset + 25);
        const { analysis } = await analyze({ event, reports: batch, venuePlanning: true });
        const supported = supportedVenueNotes(analysis, batch);
        if (analysis.problems?.length && !supported.length) throw new Error('Venue analysis did not provide verifiable report evidence');
        notes.push(...supported);
      }
      if (!notes.length) {
        await save({ status: 'no_notes', venueKey, lockedUntil: null, error: '' });
        return 'no_notes';
      }
      job.payload = venuePlanningEmail({ event, notes, recipients: routing.recipients });
      job.noteReferences = notes.filter((note) => note.venueNoteId).map((note) => ({ id: note.venueNoteId, revision: note.venueNoteRevision }));
      // Freeze body and recipients before contacting the provider; every retry uses the same key/body.
      const persisted = await save({ payload: job.payload, noteReferences: job.noteReferences, status: 'queued' });
      if (!persisted.matchedCount) return 'idle';
    }
    if (!await notesCurrent(job.noteReferences)) {
      if (!job.firstAttemptAt) {
        await save({ status: 'waiting', payload: null, noteReferences: [], nextAttemptAt: clock(), lockedUntil: null,
          error: 'Source notes changed. Rebuild from current unresolved notes.' });
        return 'waiting';
      }
      await save({ status: 'suppressed', lockedUntil: null, error: 'Source notes changed or were resolved before delivery.' });
      return 'suppressed';
    }
    const sending = await save({ status: 'processing', firstAttemptAt: job.firstAttemptAt || clock(), lockedUntil: new Date(+clock() + 15 * 60_000) });
    if (!sending.matchedCount) return 'idle';
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `venue-report:${event._id}` }, body: JSON.stringify(job.payload),
    }, { timeoutMs: 15_000, fetchImpl });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error('Venue planning email delivery was not confirmed');
    await save({ status: 'sent', sentAt: clock(), lockedUntil: null, error: '' });
    return 'sent';
  } catch (error) {
    await save({ error: clean(error.message).slice(0, 500), nextAttemptAt: new Date(+clock() + 5 * 60_000), lockedUntil: null });
    return 'waiting';
  }
};

let running = false;
export const runVenueReportNotifications = async ({ now = new Date(), Events = Event, processEvent = processVenueNotification,
  apiKey = process.env.RESEND_API_KEY, aiKey = process.env.OPENAI_API_KEY } = {}) => {
  if (running || !apiKey || !aiKey) return;
  running = true;
  const startedAt = Date.now();
  try {
    const cursor = Events.find({ createdAt: { $gte: VENUE_REPORT_START, $lte: now }, date: { $gte: todayInNewYork(now) } })
      .select('_id title date status createdAt meta managerId catereaseOperations').sort({ createdAt: 1 }).lean().cursor();
    for await (const event of cursor) await processEvent({ event, now: new Date(+now + Date.now() - startedAt), apiKey });
  } finally { running = false; }
};
