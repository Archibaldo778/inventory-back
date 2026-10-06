import Venue from '../models/Venue.js';
import VenueNote from '../models/VenueNote.js';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import { analyzeEventReports } from './eventReportAi.js';
import { captainVenueNotes, eventVenue, venueIdentity, venueIdentityKey, usableVenueName, normalizeVenuePart,
  venueNoteReports, venueNotesFingerprint } from './venues.js';

export const findEventVenue = async (event, Venues = Venue) => {
  const { name, address } = eventVenue(event);
  if (!usableVenueName(name) || !normalizeVenuePart(address)) return null;
  return Venues.findOne({ identityKeys: venueIdentityKey(name, address) }).lean();
};

export const ensureEventVenue = async (event, Venues = Venue) => {
  const existing = await findEventVenue(event, Venues);
  if (existing) return existing;
  const { name, address } = eventVenue(event);
  if (!usableVenueName(name) || !normalizeVenuePart(address)) return null;
  try { return await Venues.create(venueIdentity({ name, address })); }
  catch (error) { if (error.code === 11000) return findEventVenue(event, Venues); throw error; }
};

export const importCaptainVenueNotes = async ({ report, event, Venues = Venue, Notes = VenueNote }) => {
  if (report.status !== 'submitted' || report.reportType !== 'captain' || !report.submittedAt) return 0;
  const notes = captainVenueNotes(report);
  if (!notes.length) return 0;
  const venue = await ensureEventVenue(event, Venues);
  if (!venue) return 0;
  let added = 0;
  for (const note of notes) {
    try {
      const result = await Notes.updateOne({ sourceKey: note.sourceKey }, { $setOnInsert: { ...note, venueId: venue._id } }, { upsert: true });
      added += result.upsertedCount || 0;
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  return added;
};

let syncPromise = null;
export const runVenueKnowledgeSync = ({ Reports = EventReport, Events = Event, importNotes = importCaptainVenueNotes } = {}) => {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const reports = Reports.find({ reportType: 'captain', status: 'submitted' })
      .select('_id eventId eventDate reporterName reportType status submittedAt answers templateSnapshot').lean().cursor();
    for await (const report of reports) {
      if (!captainVenueNotes(report).length) continue;
      const event = await Events.findById(report.eventId).select('_id meta catereaseOperations').lean();
      if (event) await importNotes({ report, event });
    }
  })().finally(() => { syncPromise = null; });
  return syncPromise;
};

export const loadVenueKnowledgeReports = async (event, { Venues = Venue, Notes = VenueNote } = {}) => {
  const venue = await ensureEventVenue(event, Venues);
  if (!venue) return [];
  const notes = await Notes.find({ venueId: venue._id, observedAt: { $lte: event.createdAt },
    status: { $ne: 'resolved' }, kind: { $ne: 'positive' }, sourceEventId: { $ne: event._id } }).sort({ observedAt: -1 }).lean();
  return venueNoteReports(notes);
};

export const venueNotificationNotesCurrent = async (references, Notes = VenueNote) => {
  if (!references?.length) return true; // Existing deliveries retain their provider idempotency contract.
  const notes = await Notes.find({ _id: { $in: references.map((item) => item.id) } }).lean();
  return references.every((ref) => notes.some((note) => String(note._id) === ref.id && (note.revision || 0) === ref.revision
    && note.status !== 'resolved' && note.kind !== 'positive'));
};

export const buildVenueSummary = async ({ venue, notes, analyze = analyzeEventReports }) => {
  const reports = venueNoteReports(notes); const summaries = [];
  for (let offset = 0; offset < reports.length; offset += 25) {
    const { analysis } = await analyze({ event: { title: venue.name }, reports: reports.slice(offset, offset + 25), venuePlanning: true });
    if (analysis.summary) summaries.push(analysis.summary);
  }
  return { text: summaries.join('\n\n') || 'No unresolved venue constraints to summarize.',
    generatedAt: new Date(), fingerprint: venueNotesFingerprint(notes) };
};
