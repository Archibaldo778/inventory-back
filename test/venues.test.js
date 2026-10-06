import test from 'node:test';
import assert from 'node:assert/strict';
import { venueIdentity, venueIdentityKey, venueNoteMetadata, venueNotesFingerprint, captainVenueNotes, venueNoteReports } from '../utils/venues.js';
import { ensureEventVenue, importCaptainVenueNotes, loadVenueKnowledgeReports, venueNotificationNotesCurrent, buildVenueSummary, runVenueKnowledgeSync } from '../utils/venueKnowledge.js';
import { supportedVenueNotes, venuePlanningEmail } from '../utils/venueReportNotifications.js';

const venue = { _id: 'venue-1', name: 'Venue N', address: '10 Main Street, New York', aliases: ['N Hall'] };
const event = { _id: 'event-1', title: 'Dinner', createdAt: new Date('2026-10-06T16:00:00Z'), date: '2026-11-01', meta: { venue: 'N Hall', address: venue.address } };
const report = { _id: 'report-1', eventId: 'past-event', eventDate: '2025-10-12', submittedAt: new Date('2025-10-13T12:00:00Z'),
  reportType: 'captain', status: 'submitted', reporterName: 'Captain A', answers: {
    venueAccessNotes: 'The loading team was excellent.', venueKitchenNotes: 'The BOH is narrow; use narrow prep tables.', rentalEquipmentComments: 'N/A',
  } };
const note = { _id: 'note-1', venueId: venue._id, ...captainVenueNotes(report)[1], revision: 0 };

test('venue aliases match the same name and address, never a similarly named venue elsewhere', () => {
  const identity = venueIdentity(venue);
  assert.equal(identity.identityKeys.includes(venueIdentityKey('n HALL', '10 Main Street New York')), true);
  assert.equal(identity.identityKeys.includes(venueIdentityKey('n HALL', '20 Main Street New York')), false);
  assert.throws(() => venueIdentity({ name: 'TBD', address: 'NYC' }), /name and full address/);
  assert.throws(() => venueIdentity({ ...venue, aliases: 'not a list' }), /list/);
});

test('automatic import retains positive feedback and original concerns with source dates and stable keys', () => {
  const notes = captainVenueNotes(report);
  assert.equal(notes.length, 2); assert.equal(notes[0].text, report.answers.venueAccessNotes);
  assert.equal(notes[1].text, report.answers.venueKitchenNotes); assert.equal(notes[1].category, 'boh');
  assert.equal(notes[1].sourceReportId, report._id); assert.equal(notes[1].sourceDate, '2025-10-12');
  assert.equal(notes[1].observedAt, report.submittedAt); assert.equal(notes[1].status, 'needs_review');
  assert.equal(notes[1].sourceKey, captainVenueNotes(report)[1].sourceKey);
});

test('repeated imports never replace original text or reopen a manually resolved concern', async () => {
  const rows = new Map();
  const Venues = { findOne: () => ({ lean: async () => venue }) };
  const Notes = { updateOne: async (query, update) => {
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    if (rows.has(query.sourceKey)) return { upsertedCount: 0 };
    rows.set(query.sourceKey, structuredClone(update.$setOnInsert)); return { upsertedCount: 1 };
  } };
  assert.equal(await importCaptainVenueNotes({ report, event, Venues, Notes }), 2);
  const saved = rows.get(`captain:${report._id}:venueKitchenNotes`); saved.status = 'resolved'; saved.resolution = 'New BOH installed';
  assert.equal(await importCaptainVenueNotes({ report: { ...report, answers: { ...report.answers, venueKitchenNotes: 'Edited source' } }, event, Venues, Notes }), 0);
  assert.equal(saved.status, 'resolved'); assert.equal(saved.text, report.answers.venueKitchenNotes);
  assert.equal(await importCaptainVenueNotes({ report: { ...report, status: 'pending' }, event, Venues, Notes }), 0);
});

test('venue creation reuses aliases and recovers a concurrent unique-key insertion', async () => {
  let lookups = 0;
  const Venues = { findOne: (filter) => { assert.equal(filter.identityKeys, venueIdentityKey('N Hall', venue.address)); return { lean: async () => ++lookups > 1 ? venue : null }; },
    create: async () => { throw Object.assign(Error('duplicate'), { code: 11000 }); } };
  assert.equal(await ensureEventVenue(event, Venues), venue);
  assert.equal(await ensureEventVenue({ meta: { venue: 'TBD' } }, Venues), null);
});

test('positive and resolved notes never enter AI email inputs; long originals remain intact', () => {
  const text = 'Narrow BOH. '.repeat(500);
  const reports = venueNoteReports([{ ...note, text }, { ...note, _id: 'positive', kind: 'positive' }, { ...note, _id: 'resolved', status: 'resolved' }]);
  assert.ok(reports.length > 1); assert.equal(reports.map((entry) => entry.answers.venueKitchenNotes).join(''), text);
  assert.equal(reports.every((entry) => entry.venueNoteId === note._id), true);
  assert.equal(reports.every((entry) => entry.answers.venueKitchenNotes.length <= 1800), true);
});

test('knowledge loading uses venue aliases and source observation time, not import time', async () => {
  let filter;
  const Venues = { findOne: () => ({ lean: async () => venue }) };
  const Notes = { find: (query) => { filter = query; return { sort: () => ({ lean: async () => [note] }) }; } };
  const reports = await loadVenueKnowledgeReports(event, { Venues, Notes });
  assert.equal(filter.venueId, venue._id); assert.deepEqual(filter.observedAt, { $lte: event.createdAt });
  assert.deepEqual(filter.status, { $ne: 'resolved' }); assert.deepEqual(filter.kind, { $ne: 'positive' });
  assert.deepEqual(filter.sourceEventId, { $ne: event._id }); assert.equal(reports[0].sourceReportId, report._id);
});

test('the last delivery check rejects deleted, reclassified, revised or resolved notes', async () => {
  const references = [{ id: note._id, revision: 0 }];
  for (const [rows, expected] of [[[note], true], [[], false], [[{ ...note, kind: 'positive' }], false], [[{ ...note, status: 'resolved' }], false], [[{ ...note, revision: 1 }], false]]) {
    assert.equal(await venueNotificationNotesCurrent(references, { find: () => ({ lean: async () => rows }) }), expected);
  }
});

test('summaries exclude resolved and positive notes and become stale after a review', async () => {
  let input;
  const summary = await buildVenueSummary({ venue, notes: [note], analyze: async (value) => { input = value; return { analysis: { summary: 'Check the BOH layout.' } }; } });
  assert.equal(input.venuePlanning, true); assert.equal(summary.text, 'Check the BOH layout.');
  assert.equal(summary.fingerprint, venueNotesFingerprint([note]));
  assert.notEqual(summary.fingerprint, venueNotesFingerprint([{ ...note, status: 'resolved', revision: 1 }]));
  const empty = await buildVenueSummary({ venue, notes: [{ ...note, kind: 'positive' }], analyze: async () => { assert.fail('Positive-only history must not need AI'); } });
  assert.match(empty.text, /No unresolved/);
});

test('manual Caterease notes retain attribution and link to the exact venue note in English emails', () => {
  const manual = { ...note, source: 'caterease', sourceReportId: null, sourceEventId: null, sourceLabel: 'Caterease venue notes' };
  const reports = venueNoteReports([manual]);
  const notes = supportedVenueNotes({ problems: [{ title: 'Narrow BOH', detail: 'Confirm space before renting tables.', evidence: [manual.text] }] }, reports);
  assert.equal(notes[0].venueNoteId, note._id); assert.equal(notes[0].venueNoteRevision, 0);
  const message = venuePlanningEmail({ event, notes, recipients: ['sales@example.com'] });
  assert.match(message.text, /Caterease venue notes/); assert.match(message.text, /admin-venues\?venue=venue-1&note=note-1/);
});

test('resolving a note requires an explanation and does not silently accept an invalid category', () => {
  assert.throws(() => venueNoteMetadata({ category: 'boh', kind: 'concern', status: 'resolved' }), /Explain/);
  assert.throws(() => venueNoteMetadata({ category: 'invalid', kind: 'concern', status: 'active' }), /valid/);
  assert.equal(venueNoteMetadata({ category: 'boh', kind: 'concern', status: 'resolved', resolution: 'Confirmed new room' }).resolution, 'Confirmed new room');
});

test('overlapping scheduled scans await the same import before email evaluation can continue', async () => {
  let release; let imports = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const Reports = { find: () => ({ select: () => ({ lean: () => ({ cursor: async function* () { yield report; } }) }) }) };
  const Events = { findById: () => ({ select: () => ({ lean: async () => event }) }) };
  const first = runVenueKnowledgeSync({ Reports, Events, importNotes: async () => { imports++; await gate; } });
  const second = runVenueKnowledgeSync({ Reports, Events });
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(imports, 1);
  release(); await Promise.all([first, second]);
});
