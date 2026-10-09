import test from 'node:test';
import assert from 'node:assert/strict';
import { processEventDigest, eventDigestRecipients, eventDigestPayload, generateEventDigest, sendEventDigest, runEventReportDigests } from '../utils/eventReportDigest.js';
import EventReportDigest from '../models/EventReportDigest.js';
import EventReport from '../models/EventReport.js';

const reports = ['a', 'b'].map((id) => ({ _id: id, reporterEmail: `${id}@example.com`, reportType: 'captain', status: 'submitted', answers: {}, submittedAt: '2026-10-09' }));
const context = () => ({ event: { title: 'Dinner', date: '2026-10-09' }, reports: structuredClone(reports) });
const harness = () => {
  const job = { _id: 'event', status: 'processing' };
  const sent = []; let generations = 0;
  const deps = { load: async () => context(), save: async (fields) => { Object.assign(job, fields); return true; },
    generate: async () => { generations++; return 'Complete summary. '.repeat(350); }, recipients: async () => ['office@example.com'],
    send: async (value) => { sent.push(structuredClone(value)); return 'provider-id'; }, now: () => new Date('2026-10-09T15:00:00Z') };
  return { job, deps, sent, generations: () => generations };
};

test('aggregate sends once after all reports with no 300-word truncation', async () => {
  const h = harness();
  await processEventDigest(h.job, h.deps);
  assert.equal(h.job.status, 'sent'); assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0].payload.text.split(/\s+/).length > 300);
  assert.equal(h.sent[0].payload.cc, undefined);
  await processEventDigest(h.job, h.deps);
  assert.equal(h.sent.length, 1);
});

test('a missing kitchen report prevents AI calls and sending', async () => {
  const h = harness();
  h.deps.load = async () => ({ ...context(), reports: [...reports, { _id: 'chef', reportType: 'kitchen', status: 'pending' }] });
  await processEventDigest(h.job, h.deps);
  assert.equal(h.generations(), 0); assert.equal(h.sent.length, 0); assert.equal(h.job.status, 'waiting');
});

test('new required report during generation prevents sending', async () => {
  const h = harness(); let loads = 0;
  h.deps.load = async () => ++loads === 1 ? context() : { ...context(), reports: [...reports, { _id: 'chef', reportType: 'kitchen', status: 'pending' }] };
  await processEventDigest(h.job, h.deps);
  assert.equal(h.generations(), 1); assert.equal(h.sent.length, 0); assert.equal(h.job.payload, null);
});

test('uncertain delivery retries the exact frozen payload without regenerating', async () => {
  const h = harness();
  const send = h.deps.send;
  h.deps.send = async (value) => { await send(value); throw new Error('Connection lost after acceptance'); };
  await processEventDigest(h.job, h.deps);
  assert.equal(h.job.status, 'waiting'); assert.ok(h.job.firstAttemptAt); assert.ok(h.job.payload);
  h.deps.send = send;
  await processEventDigest(h.job, h.deps);
  assert.equal(h.job.status, 'sent'); assert.equal(h.generations(), 1);
  assert.deepEqual(h.sent[0], h.sent[1]);
});

test('uncertain delivery is suppressed if the required reports change', async () => {
  const h = harness(); h.deps.send = async () => { throw new Error('Timeout'); };
  await processEventDigest(h.job, h.deps);
  h.deps.load = async () => ({ ...context(), reports: [...reports, { _id: 'chef', reportType: 'kitchen', status: 'pending' }] });
  await processEventDigest(h.job, h.deps);
  assert.equal(h.job.status, 'suppressed'); assert.equal(h.generations(), 1);
});

test('uncertain delivery expires before provider deduplication window ends', async () => {
  const h = harness(); h.job.firstAttemptAt = new Date('2026-10-08T15:00:00Z');
  await processEventDigest(h.job, h.deps);
  assert.equal(h.job.status, 'expired'); assert.equal(h.sent.length, 0); assert.equal(h.generations(), 0);
});

test('lost durable lease prevents sending', async () => {
  const h = harness(); h.deps.save = async () => false;
  await processEventDigest(h.job, h.deps);
  assert.equal(h.sent.length, 0);
});

test('routing merges captain and kitchen office teams and excludes every reporter and CC', async () => {
  const input = [...reports, { _id: 'chef', reportType: 'kitchen', reporterEmail: 'chef@example.com' }];
  const types = [];
  const to = await eventDigestRecipients({ event: {}, reports: input, resolveDelivery: async ({ report }) => {
    assert.equal(report.reporterEmail, ''); types.push(report.reportType);
    return { recipients: ['office@example.com', 'A@example.com', 'chef@example.com', `${report.reportType}-office@example.com`], cc: ['b@example.com'] };
  } });
  assert.deepEqual(types, ['captain', 'kitchen']);
  assert.deepEqual(to, ['captain-office@example.com', 'kitchen-office@example.com', 'office@example.com']);
});

test('routing failure never sends to a partial recipient list', async () => {
  await assert.rejects(eventDigestRecipients({ reports, resolveDelivery: async () => ({ status: 'failed', error: 'Routing blocked' }) }), /Routing blocked/);
});

test('summary HTML escapes report text and event titles', () => {
  const payload = eventDigestPayload({ event: { title: '<script>alert(1)</script>' }, summary: '<img src=x onerror=alert(1)>', recipients: ['office@example.com'] });
  assert.doesNotMatch(payload.html, /<script>|<img/); assert.match(payload.html, /&lt;img/);
});

test('AI retries an incomplete answer with a larger budget and does not truncate complete text', async () => {
  const calls = [];
  const output = 'Complete detail. '.repeat(400);
  const summary = await generateEventDigest({ ...context(), apiKey: 'fake', fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => calls.length === 1 ? { status: 'incomplete', output_text: 'Partial' } : { status: 'completed', output_text: output } };
  } });
  assert.equal(summary, output.trim()); assert.deepEqual(calls.map((call) => call.max_output_tokens), [16000, 32000]);
});

test('AI never returns incomplete output for delivery', async () => {
  await assert.rejects(generateEventDigest({ ...context(), apiKey: 'fake', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'incomplete', output_text: 'Partial' }) }) }), /no partial summary/);
});

test('provider uses stable event idempotency key and sends no reporter copies', async () => {
  const calls = [];
  const args = { eventId: 'event', payload: eventDigestPayload({ event: {}, summary: 'Summary', recipients: ['office@example.com'] }), apiKey: 'fake',
    fetchImpl: async (_url, options) => { calls.push(options); return { ok: true, json: async () => ({ id: 'sent' }) }; } };
  await sendEventDigest(args); await sendEventDigest(args);
  assert.equal(calls[0].headers['Idempotency-Key'], 'event-report-digest:event');
  assert.equal(calls[0].body, calls[1].body); assert.equal(JSON.parse(calls[0].body).cc, undefined);
});

test('worker creates durable jobs only from new submission markers and clears marker only after creation', async (t) => {
  const steps = [];
  t.mock.method(EventReport, 'find', (query) => {
    assert.deepEqual(query, { digestRequested: true, status: 'submitted' });
    return { select: () => ({ limit: () => ({ lean: async () => [{ _id: 'report', eventId: 'event' }] }) }) };
  });
  t.mock.method(EventReportDigest, 'updateOne', async (query, update, options) => {
    steps.push('job'); assert.deepEqual(query, { _id: 'event' }); assert.equal(options.upsert, true);
    assert.equal(update.$setOnInsert.status, 'waiting');
  });
  t.mock.method(EventReport, 'updateOne', async () => { steps.push('clear'); });
  t.mock.method(EventReportDigest, 'findOneAndUpdate', (query, update) => {
    assert.deepEqual(query.status.$in, ['waiting', 'queued', 'processing']); assert.ok(update.$set.lockToken);
    assert.ok(query.$or); return { select: () => ({ lean: async () => null }) };
  });
  await runEventReportDigests(); assert.deepEqual(steps, ['job', 'clear']);
});

test('job creation failure leaves submission marker for next worker run', async (t) => {
  t.mock.method(EventReport, 'find', () => ({ select: () => ({ limit: () => ({ lean: async () => [{ _id: 'report', eventId: 'event' }] }) }) }));
  t.mock.method(EventReportDigest, 'updateOne', async () => { throw new Error('Database unavailable'); });
  const clear = t.mock.method(EventReport, 'updateOne', async () => {});
  await assert.rejects(runEventReportDigests(), /Database unavailable/);
  assert.equal(clear.mock.callCount(), 0);
});
