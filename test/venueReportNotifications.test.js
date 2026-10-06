import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUE_REPORT_START, eventVenue, sameReportVenue, venueNotificationEligible, supportedVenueNotes,
  venuePlanningEmail, loadVenueReports, processVenueNotification, runVenueReportNotifications } from '../utils/venueReportNotifications.js';

const now = new Date('2026-10-06T16:00:00Z');
const event = { _id: 'new-event', title: 'Fall dinner', date: '2026-11-20', createdAt: now,
  meta: { venue: 'Venue N', address: '10 Main Street, New York', reportSalesUserId: 'sales' } };
const report = { _id: 'old-report', eventId: 'old-event', eventDate: '2025-10-12', reporterName: 'Captain A',
  reportType: 'captain', status: 'submitted', answers: { venueKitchenNotes: 'The back of house was narrow. Rent narrow prep tables.' } };
const analysis = { problems: [{ title: 'Limited BOH space', detail: 'Confirm the current layout and consider narrow prep tables.', evidence: [report.answers.venueKitchenNotes] }] };
const directory = { teams: [{ _id: 'team', salesUserId: 'sales', name: 'Sales team', reportDeliveryEnabled: true }], users: [
  { _id: 'sales', username: 'Sales', email: 'sales@example.com', isActive: true },
  { _id: 'member', username: 'Member', email: 'member@example.com', teamId: 'team', receivesTeamReports: true },
  { _id: 'other', username: 'Other', email: 'other@example.com', teamId: 'other-team', receivesTeamReports: true },
] };

const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some((branch) => matches(row, branch));
  if (value === null) return row[key] == null;
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, target]) => {
    if (op === '$in') return target.includes(row[key]);
    if (op === '$ne') return row[key] !== target;
    if (op === '$lte') return row[key] != null && row[key] <= target;
    throw new Error(`Unexpected operator ${op}`);
  });
  return row[key] === value;
});
const memory = (saved) => {
  let row = saved ? structuredClone(saved) : null;
  const calls = []; const analyses = [];
  const Jobs = {
    async updateOne(filter, update, options = {}) {
      if (!row && options.upsert) row = { _id: filter._id, lockedUntil: null, ...structuredClone(update.$setOnInsert) };
      if (!row || !matches(row, filter)) return { matchedCount: 0 };
      Object.assign(row, structuredClone(update.$set || {}));
      return { matchedCount: 1 };
    },
    findOneAndUpdate(filter, update) {
      if (!row || !matches(row, filter)) return { select: async () => null };
      Object.assign(row, structuredClone(update.$set));
      const snapshot = structuredClone(row);
      return { select: async () => snapshot };
    },
  };
  return { event, now, Jobs, apiKey: 'fake-key', calls, analyses, row: () => row,
    loadReports: async () => [report], loadTeams: async () => structuredClone(directory),
    analyze: async (input) => { analyses.push(input); return { analysis }; },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'delivery' }) }; },
  };
};

test('venue rollout uses creation midnight in New York, not the future event date or an update timestamp', () => {
  assert.equal(VENUE_REPORT_START.toISOString(), '2026-10-06T04:00:00.000Z');
  assert.equal(venueNotificationEligible({ ...event, createdAt: new Date(+VENUE_REPORT_START - 1), updatedAt: now }, now), false);
  assert.equal(venueNotificationEligible({ ...event, createdAt: VENUE_REPORT_START }, now), true);
  assert.equal(venueNotificationEligible({ ...event, createdAt: undefined }, now), false);
  assert.equal(venueNotificationEligible({ ...event, createdAt: new Date(+now + 1) }, now), false);
  assert.equal(venueNotificationEligible({ ...event, date: '2026-10-05' }, now), false);
  assert.equal(venueNotificationEligible({ ...event, status: 'Cancelled' }, now), false);
  assert.equal(venueNotificationEligible({ ...event, date: '2026-10-06' }, now), true);
});

test('venue matching tolerates case and punctuation but rejects other addresses and guesses', () => {
  assert.equal(sameReportVenue(event, { meta: { nowsta: { venue: 'VENUE N', address: '10 Main Street New York' } } }), true);
  assert.equal(sameReportVenue(event, { meta: { ...event.meta, address: '11 Main Street New York' } }), false);
  assert.equal(sameReportVenue(event, { meta: { venue: 'Venue N' } }), false);
  assert.equal(sameReportVenue(event, { meta: { ...event.meta, venue: 'Venue North' } }), false);
  assert.equal(sameReportVenue({ meta: { venue: 'TBD', address: 'NYC' } }, { meta: { venue: 'TBD', address: 'NYC' } }), false);
  assert.deepEqual(eventVenue(event), { name: 'Venue N', address: '10 Main Street, New York' });
});

test('venue recommendations require exact source evidence and preserve the report identity and date', () => {
  const notes = supportedVenueNotes(analysis, [report]);
  assert.equal(notes.length, 1); assert.equal(notes[0].reportId, report._id); assert.equal(notes[0].date, report.eventDate);
  assert.equal(notes[0].quote, report.answers.venueKitchenNotes);
  assert.deepEqual(supportedVenueNotes({ problems: [{ ...analysis.problems[0], evidence: ['There is no freight elevator.'] }] }, [report]), []);
  assert.equal(supportedVenueNotes({ problems: [...analysis.problems, ...analysis.problems] }, [report]).length, 1);
});

test('English email identifies historical observations, escapes text, and links to the source event reports', () => {
  const message = venuePlanningEmail({ event: { ...event, title: '<script>bad</script>' }, notes: supportedVenueNotes(analysis, [report]), recipients: ['sales@example.com'] });
  assert.match(message.subject, /Venue planning notes/);
  assert.match(message.text, /historical observations; confirm current conditions/);
  assert.match(message.text, /2025-10-12, Captain A, report old-report/);
  assert.match(message.text, /\/events\/old-event\?view=reports/);
  assert.doesNotMatch(message.html, /<script>/); assert.match(message.html, /&lt;script&gt;/);
  assert.deepEqual(message.to, ['sales@example.com']); assert.equal(message.cc, undefined);
});

test('history loading only uses submitted captain reports available when the new event appeared and the same venue', async () => {
  const queries = [];
  const Reports = {
    distinct: async (key, filter) => { queries.push(filter); return ['old-event', 'other-event']; },
    find: (filter) => { queries.push(filter); return { sort: () => ({ lean: async () => [report] }) }; },
  };
  const Events = { find: (filter) => {
    queries.push(filter);
    return { select: () => ({ lean: async () => [
      { ...event, _id: 'old-event' }, { ...event, _id: 'other-event', meta: { ...event.meta, address: 'Elsewhere' } },
    ] }) };
  } };
  assert.deepEqual(await loadVenueReports(event, { Events, Reports }), [report]);
  assert.equal(queries[0].reportType, 'captain'); assert.equal(queries[0].status, 'submitted');
  assert.deepEqual(queries[0].submittedAt, { $lte: event.createdAt });
  assert.deepEqual(queries[1].date, { $lt: event.date });
  assert.deepEqual(queries[2].eventId, { $in: ['old-event'] });
});

test('simultaneous workers and subsequent polls deliver one venue email to the assigned sales team only', async () => {
  const store = memory();
  assert.deepEqual((await Promise.all([processVenueNotification(store), processVenueNotification(store)])).sort(), ['idle', 'sent']);
  assert.equal(store.calls.length, 1); assert.equal(store.row().status, 'sent');
  const message = JSON.parse(store.calls[0].options.body);
  assert.deepEqual(message.to, ['sales@example.com', 'member@example.com']);
  assert.equal(store.analyses[0].venuePlanning, true);
  assert.equal(await processVenueNotification(store), 'idle');
  assert.equal(store.calls.length, 1);
});

test('old events never create jobs or send even when they are updated today', async () => {
  const store = memory();
  assert.equal(await processVenueNotification({ ...store, event: { ...event, createdAt: new Date('2026-10-05T12:00:00Z'), updatedAt: now } }), 'skipped');
  assert.equal(store.row(), null); assert.equal(store.calls.length, 0);
});

test('missing venue or team waits and sends after metadata becomes ready', async () => {
  for (const missing of ['venue', 'team']) {
    const store = memory();
    const options = missing === 'venue' ? { event: { ...event, meta: {} } } : { loadTeams: async () => ({ teams: [], users: [] }) };
    assert.equal(await processVenueNotification({ ...store, ...options }), 'waiting');
    assert.equal(store.calls.length, 0); assert.equal(store.analyses.length, 0);
    assert.equal(await processVenueNotification({ ...store, now: new Date(+now + 6 * 60_000) }), 'sent');
  }
});

test('no previous reports or no venue problems sends no filler email', async () => {
  for (const options of [{ loadReports: async () => [] }, { analyze: async () => ({ analysis: { problems: [] } }) }]) {
    const store = memory();
    assert.equal(await processVenueNotification({ ...store, ...options }), 'no_notes');
    assert.equal(store.calls.length, 0); assert.equal(await processVenueNotification(store), 'idle');
  }
});

test('a corrected venue is checked again after no notes, while a sent email stays deduplicated', async () => {
  const store = memory();
  assert.equal(await processVenueNotification({ ...store, loadReports: async () => [] }), 'no_notes');
  const changed = { ...event, meta: { ...event.meta, venue: 'Venue South' } };
  assert.equal(await processVenueNotification({ ...store, event: changed }), 'sent');
  assert.equal(await processVenueNotification(store), 'idle'); assert.equal(store.calls.length, 1);
});

test('placeholder venues remain pending until a real venue is assigned', async () => {
  const store = memory();
  assert.equal(await processVenueNotification({ ...store, event: { ...event, meta: { ...event.meta, venue: 'TBD' } } }), 'waiting');
  assert.equal(store.analyses.length, 0); assert.equal(store.calls.length, 0);
  assert.equal(await processVenueNotification({ ...store, now: new Date(+now + 6 * 60_000) }), 'sent');
});

test('large venue histories are analyzed in bounded batches without dropping older reports', async () => {
  const store = memory();
  const reports = Array.from({ length: 51 }, (_, index) => ({ ...report, _id: `report-${index}` }));
  assert.equal(await processVenueNotification({ ...store, loadReports: async () => reports }), 'sent');
  assert.deepEqual(store.analyses.map((input) => input.reports.length), [25, 25, 1]);
  const message = JSON.parse(store.calls[0].options.body);
  assert.match(message.text, /report-50/);
});

test('a worker that loses its claim during AI analysis cannot send', async () => {
  const store = memory();
  assert.equal(await processVenueNotification({ ...store, analyze: async () => {
    store.row().lockToken = 'replacement-worker'; return { analysis };
  } }), 'idle');
  assert.equal(store.calls.length, 0);
});

test('AI failures or unsupported evidence wait without sending fabricated recommendations', async () => {
  for (const analyze of [async () => { throw Error('AI unavailable'); }, async () => ({ analysis: { problems: [{ ...analysis.problems[0], evidence: ['Invented constraint'] }] } })]) {
    const store = memory();
    assert.equal(await processVenueNotification({ ...store, analyze }), 'waiting');
    assert.equal(store.calls.length, 0); assert.equal(store.row().payload, undefined);
  }
});

test('ambiguous delivery retries the frozen message with the same idempotency key, never beyond 23 hours', async () => {
  const store = memory();
  assert.equal(await processVenueNotification({ ...store, fetchImpl: async (...args) => { await store.fetchImpl(...args); throw Error('timeout after acceptance'); } }), 'waiting');
  assert.equal(store.row().status, 'processing');
  assert.equal(await processVenueNotification(store), 'idle');
  assert.equal(await processVenueNotification({ ...store, now: new Date(+now + 6 * 60_000), loadTeams: async () => { throw Error('Must use frozen body'); } }), 'sent');
  assert.deepEqual(store.calls[0], store.calls[1]); assert.equal(store.analyses.length, 1);
  const expired = memory({ _id: event._id, status: 'processing', payload: {}, firstAttemptAt: new Date(+now - 23 * 3600_000), nextAttemptAt: now, lockedUntil: null });
  assert.equal(await processVenueNotification(expired), 'expired'); assert.equal(expired.calls.length, 0);
});

test('worker recovers an abandoned claim and does not steal a live claim', async () => {
  for (const [lockedUntil, status] of [[new Date(+now - 1), 'sent'], [new Date(+now + 60_000), 'idle']]) {
    const store = memory({ _id: event._id, status: 'waiting', nextAttemptAt: now, lockedUntil, lockToken: 'old-worker' });
    assert.equal(await processVenueNotification(store), status);
  }
});

test('scheduled scanner queries the creation cutoff and does not run without configured providers', async () => {
  let query; const processed = [];
  const Events = { find: (filter) => { query = filter; return { select: () => ({ sort: () => ({ lean: () => ({ cursor: async function* () { yield event; } }) }) }) }; } };
  const options = { now, Events, apiKey: 'fake-email', aiKey: 'fake-ai', processEvent: async (input) => processed.push(input.event._id) };
  await runVenueReportNotifications({ ...options, aiKey: '' }); assert.equal(query, undefined);
  await runVenueReportNotifications(options);
  assert.deepEqual(query.createdAt, { $gte: VENUE_REPORT_START, $lte: now }); assert.deepEqual(processed, [event._id]);
});
