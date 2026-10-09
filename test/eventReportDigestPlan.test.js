import test from 'node:test';
import assert from 'node:assert/strict';
import { eventDigestReadiness, buildEventDigestAiRequest } from '../utils/eventReportDigestPlan.js';

const worker = (id) => ({ companyUserId: id, email: `${id}@example.com`, name: id, status: 'confirmed' });
const report = (id, reportType = 'captain', status = 'submitted') => ({ _id: id, reporterEmail: `${id}@example.com`, reporterName: id, reportType, status, submittedAt: '2026-10-08T16:00:00Z', answers: { overallFeedback: `${id} feedback` } });
const event = { title: 'Dinner', date: '2026-10-08', meta: { nowsta: { apiEventId: '1' } } };
const schedule = { shifts: [
  { position: 'Captain - Floor', workers: [worker('one')] },
  { position: 'Captain - Bar', workers: [worker('two')] },
  { position: 'Lead Chef', workers: [worker('chef')] },
] };

test('two captains are sufficient but a kitchen lead who has not opened a form still blocks the summary', () => {
  const reports = [report('one'), report('two')];
  assert.equal(eventDigestReadiness({ event, schedule, reports }).ready, false);
  assert.equal(eventDigestReadiness({ event, schedule, reports: [...reports, report('chef', 'kitchen', 'pending')] }).ready, false);
  const ready = eventDigestReadiness({ event, schedule, reports: [...reports, report('chef', 'kitchen')] });
  assert.equal(ready.ready, true); assert.equal(ready.captainCount, 2); assert.equal(ready.reports.length, 3);
});

test('one captain and several kitchen leads do not satisfy the captain threshold', () => {
  const onlyOne = { shifts: [schedule.shifts[0], schedule.shifts[2], { position: 'Proofer Lead', workers: [worker('proofer')] }] };
  assert.equal(eventDigestReadiness({ event, schedule: onlyOne, reports: [report('one'), report('chef', 'kitchen'), report('proofer', 'kitchen')] }).ready, false);
});

test('every kitchen lead position is required, not only a lead chef', () => {
  for (const position of ['Kitchen Lead', 'Proofer Lead', 'Executive Chef', 'Lead Chef']) {
    const roster = { shifts: [...schedule.shifts.slice(0, 2), { position, workers: [worker('chef')] }] };
    assert.equal(eventDigestReadiness({ event, schedule: roster, reports: [report('one'), report('two')] }).ready, false);
    assert.equal(eventDigestReadiness({ event, schedule: roster, reports: [report('one'), report('two'), report('chef', 'kitchen')] }).ready, true);
  }
});

test('duplicate shifts do not count twice and a sanitation captain must submit too', () => {
  const roster = { shifts: [...schedule.shifts, schedule.shifts[0], { position: 'Captain - Sanitation', workers: [worker('sanit')] }] };
  const reports = [report('one'), report('two'), report('chef', 'kitchen')];
  const waiting = eventDigestReadiness({ event, schedule: roster, reports });
  assert.equal(waiting.captainCount, 3); assert.equal(waiting.ready, false);
  assert.equal(eventDigestReadiness({ event, schedule: roster, reports: [...reports, report('sanit')] }).ready, true);
});

test('cancelled requests are waived; declined bookings and ordinary chefs do not add requirements', () => {
  const roster = { shifts: [...schedule.shifts, { position: 'Captain', workers: [{ ...worker('declined'), status: 'declined' }] }, { position: 'Chef', workers: [worker('cook')] }] };
  const ready = eventDigestReadiness({ event, schedule: roster, reports: [report('one'), report('two'), report('chef', 'kitchen', 'cancelled')] });
  assert.equal(ready.ready, true); assert.equal(ready.reports.length, 2);
});

test('missing Nowsta data and cancelled events never authorize a summary', () => {
  const reports = [report('one'), report('two'), report('chef', 'kitchen')];
  assert.equal(eventDigestReadiness({ event, reports }).ready, false);
  assert.equal(eventDigestReadiness({ event: { ...event, status: 'cancelled' }, schedule, reports }).ready, false);
  assert.equal(eventDigestReadiness({ event: { ...event, title: 'Venue walkthrough' }, schedule, reports }).ready, false);
});

test('a new lead assignment changes readiness even after all previously known reports were submitted', () => {
  const reports = [report('one'), report('two'), report('chef', 'kitchen')];
  const before = eventDigestReadiness({ event, schedule, reports });
  const roster = { shifts: [...schedule.shifts, { position: 'Kitchen Lead', workers: [worker('new-chef')] }] };
  assert.equal(before.ready, true);
  assert.equal(eventDigestReadiness({ event, schedule: roster, reports }).ready, false);
  const after = eventDigestReadiness({ event, schedule: roster, reports: [...reports, report('new-chef', 'kitchen')] });
  assert.equal(after.ready, true); assert.notEqual(after.signature, before.signature);
});

test('AI request includes all textual reports without photos, emails or the individual 300-word limit', () => {
  const reports = Array.from({ length: 55 }, (_, i) => ({ ...report(`person-${i}`, i % 2 ? 'captain' : 'kitchen'), photos: [{ url: 'https://private-image.example.com' }], photoData: ['secret-image-bytes'], answers: { overallFeedback: 'Important detail. '.repeat(200), overallEvaluation: 'Important detail. '.repeat(200) } }));
  const request = buildEventDigestAiRequest({ event, reports });
  const input = JSON.parse(request.input);
  assert.equal(input.reports.length, 55);
  assert.equal(request.store, false);
  assert.doesNotMatch(request.input, /example.com|secret-image-bytes/);
  assert.match(request.instructions, /no word-count limit/);
  assert.doesNotMatch(request.instructions, /300 words/);
  assert.ok(input.reports[0].answers.some((answer) => answer.answer.length > 2000));
});
