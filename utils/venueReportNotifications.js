import crypto from 'node:crypto';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import VenueReportNotification from '../models/VenueReportNotification.js';
import { analyzeEventReports, eventReportAnalysisInput } from './eventReportAi.js';
import { loadReportTeamDirectory, resolveTeamRouting } from './reportTeams.js';
import { userInviteUrl } from './userInvitations.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

// October 6, 2026 at midnight in New York. This is a creation cutoff, not an event-date cutoff.
export const VENUE_REPORT_START = new Date('2026-10-06T04:00:00.000Z');
const clean = (value) => String(value || '').trim();
const normalize = (value) => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const todayInNewYork = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const usableVenueName = (name) => Boolean(normalize(name)) && !['tbd', 'n a', 'na', 'none', 'unknown', 'off site', 'private residence'].includes(normalize(name));
export const eventVenue = (event) => ({
  name: clean(event?.meta?.venue || event?.meta?.nowsta?.venue || event?.catereaseOperations?.eventVenue),
  address: clean(event?.meta?.address || event?.meta?.nowsta?.address),
});
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
        reportId: String(report._id), eventId: String(report.eventId), date: report.eventDate, reporter: report.reporterName });
    }
  }
  return notes.filter((note, index) => notes.findIndex((other) => other.reportId === note.reportId && other.quote === note.quote) === index);
};

export const venuePlanningEmail = ({ event, notes, recipients }) => {
  const venue = eventVenue(event);
  const link = (id) => new URL(`/events/${encodeURIComponent(String(id))}?view=reports`, userInviteUrl('')).href;
  const heading = `Venue planning notes — ${venue.name} — ${event.date}`;
  const introduction = `A new event, ${event.title}, is scheduled at ${venue.name} (${venue.address}) on ${event.date}. Previous captain's reports noted the following venue constraints. These are historical observations; confirm current conditions before making arrangements.`;
  return {
    from: clean(process.env.EVENT_REPORT_FROM) || 'Staffing and Service Department <reports@reports.occdecks.com>',
    to: recipients, subject: heading,
    text: `${heading}\n\n${introduction}\n\n${notes.map((note) => `${note.title}\nReported: ${note.quote}\nPlanning recommendation: ${note.recommendation}\nSource: ${note.date}, ${note.reporter}, report ${note.reportId}\n${link(note.eventId)}`).join('\n\n')}\n\nUpcoming event: ${link(event._id)}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(introduction)}</p>${notes.map((note) => `<h3>${escapeHtml(note.title)}</h3><p><strong>Reported:</strong> ${escapeHtml(note.quote)}</p><p><strong>Planning recommendation:</strong> ${escapeHtml(note.recommendation)}</p><p>Source: ${escapeHtml(note.date)}, ${escapeHtml(note.reporter)} — <a href="${escapeHtml(link(note.eventId))}">View captain's reports</a> (report ${escapeHtml(note.reportId)})</p>`).join('')}<p><a href="${escapeHtml(link(event._id))}">View upcoming event</a></p></div>`,
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
  loadReports = loadVenueReports, loadTeams = loadReportTeamDirectory, analyze = analyzeEventReports,
  fetchImpl = globalThis.fetch, apiKey = process.env.RESEND_API_KEY,
} = {}) => {
  if (!apiKey || !venueNotificationEligible(event, now)) return 'skipped';
  const startedAt = Date.now();
  const clock = () => new Date(+now + Date.now() - startedAt);
  const venue = eventVenue(event);
  const venueKey = `${normalize(venue.name)}|${normalize(venue.address)}`;
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
      // Freeze body and recipients before contacting the provider; every retry uses the same key/body.
      const persisted = await save({ payload: job.payload, status: 'queued' });
      if (!persisted.matchedCount) return 'idle';
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
