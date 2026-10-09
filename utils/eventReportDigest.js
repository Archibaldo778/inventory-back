import crypto from 'node:crypto';
import EventReportDigest from '../models/EventReportDigest.js';
import EventReport from '../models/EventReport.js';
import Event from '../models/Event.js';
import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import EventReportSettings from '../models/EventReportSettings.js';
import { eventDigestReadiness, buildEventDigestAiRequest } from './eventReportDigestPlan.js';
import { resolveEventReportDelivery } from './eventReportEmail.js';
import { resolveReportSalesRep } from './eventReportSalesRep.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const RETRY_MS = 5 * 60_000;
const RETRY_WINDOW_MS = 23 * 60 * 60_000;
const clean = (value) => String(value || '').trim();
const email = (value) => clean(value).toLowerCase();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const generateEventDigest = async ({ event, reports, fetchImpl = globalThis.fetch, apiKey = process.env.OPENAI_API_KEY }) => {
  if (!apiKey) throw new Error('OpenAI API key is not configured');
  const request = buildEventDigestAiRequest({ event, reports });
  for (const maxTokens of [16000, 32000]) {
    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, max_output_tokens: maxTokens }),
    }, { timeoutMs: 120_000, fetchImpl });
    const body = await response.json();
    if (!response.ok) throw new Error(`Event summary AI HTTP ${response.status}`);
    if (body.status === 'incomplete') continue;
    const text = clean(body.output_text || (body.output || []).flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text').map((item) => item.text).join('\n'));
    if (body.status !== 'completed' || !text) throw new Error('Event summary AI response was not complete');
    return text;
  }
  throw new Error('Event summary AI response exceeded its output budget; no partial summary was sent');
};

export const eventDigestRecipients = async ({ event, reports, configuredRecipients = [], resolveDelivery = resolveEventReportDelivery }) => {
  const recipients = new Set();
  // Reporter copies are never part of the office digest, including addresses in configured teams.
  const reporters = new Set(reports.map((report) => email(report.reporterEmail)).filter(Boolean));
  for (const reportType of new Set(reports.map((report) => report.reportType || 'captain'))) {
    const original = reports.find((report) => (report.reportType || 'captain') === reportType);
    const routing = await resolveDelivery({ event, configuredRecipients,
      report: { ...original, reportType, salesRep: resolveReportSalesRep(original, event), reporterEmail: '' } });
    if (routing.status) throw new Error(routing.error || 'No office recipients configured');
    for (const address of routing.recipients || []) if (email(address) && !reporters.has(email(address))) recipients.add(email(address));
  }
  if (!recipients.size) throw new Error('No office recipients configured');
  return [...recipients].sort();
};

export const eventDigestPayload = ({ event, summary, recipients }) => ({
  from: clean(process.env.EVENT_REPORT_FROM) || 'Staffing and Service Department <reports@reports.occdecks.com>',
  to: recipients,
  subject: `Event summary · ${clean(event.title).replace(/[\r\n]/g, ' ').slice(0, 200)} · ${clean(event.date)}`,
  text: `EVENT SUMMARY\n${clean(event.title)} · ${clean(event.date)}\n\n${summary}\n\nAI summary based on all required captain and kitchen reports.`,
  html: `<h1>Event summary</h1><p>${escapeHtml(event.title || '')} · ${escapeHtml(event.date || '')}</p><div style="white-space:pre-wrap">${escapeHtml(summary)}</div><p>AI summary based on all required captain and kitchen reports.</p>`,
});

export const sendEventDigest = async ({ eventId, payload, fetchImpl = globalThis.fetch, apiKey = process.env.RESEND_API_KEY }) => {
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `event-report-digest:${eventId}` },
    body: JSON.stringify(payload),
  }, { timeoutMs: 30_000, fetchImpl });
  const body = await response.json();
  if (!response.ok || !body.id) throw new Error(`Event summary delivery failed (HTTP ${response.status})`);
  return body.id;
};

// save must compare the durable lock token and return false if another worker owns the job.
export const processEventDigest = async (job, { load, save, generate = generateEventDigest,
  recipients = eventDigestRecipients, send = sendEventDigest, now = () => new Date() }) => {
  if (['sent', 'expired', 'suppressed'].includes(job.status)) return;
  const retry = (extra = {}) => save({ status: 'waiting', nextAttemptAt: new Date(+now() + RETRY_MS), ...extra });
  try {
    if (job.firstAttemptAt && +now() - +new Date(job.firstAttemptAt) >= RETRY_WINDOW_MS) {
      await save({ status: 'expired', error: 'Delivery confirmation unavailable; automatic retries stopped to prevent duplicates' }); return;
    }
    let context = await load(job._id);
    let plan = eventDigestReadiness(context);
    if (!plan.ready || (job.payload && job.signature !== plan.signature)) {
      await retry(job.firstAttemptAt ? { status: 'suppressed', error: 'Required reports changed after a delivery attempt' }
        : { payload: null, signature: '', error: '' }); return;
    }
    let payload = job.payload;
    if (!payload) {
      const to = await recipients({ ...context, reports: plan.reports });
      const summary = await generate({ event: context.event, reports: plan.reports });
      payload = eventDigestPayload({ event: context.event, summary, recipients: to });
    }
    // Check again after AI generation and before every retry of an uncertain delivery.
    context = await load(job._id);
    const fresh = eventDigestReadiness(context);
    const to = fresh.ready ? await recipients({ ...context, reports: fresh.reports }) : [];
    if (!fresh.ready || plan.signature !== fresh.signature || JSON.stringify(to) !== JSON.stringify(payload.to)) {
      await retry(job.firstAttemptAt ? { status: 'suppressed', error: 'Required reports or recipients changed after a delivery attempt' }
        : { payload: null, signature: '', error: '' }); return;
    }
    const firstAttemptAt = job.firstAttemptAt || now();
    if (!await save({ payload, signature: fresh.signature, firstAttemptAt, error: '' })) return;
    const providerId = await send({ eventId: String(job._id), payload });
    await save({ status: 'sent', sentAt: now(), providerId, error: '' });
  } catch (error) {
    await retry({ error: clean(error?.message).slice(0, 1000) });
  }
};

const loadDigestContext = async (eventId) => {
  const [event, reports, settings] = await Promise.all([
    Event.findById(eventId).select('title date client status managerId catereaseOperations meta').lean(),
    EventReport.find({ eventId }).select('-photos').lean(),
    EventReportSettings.findOne({ key: 'default' }).lean(),
  ]);
  const nowstaId = event?.meta?.nowsta?.apiEventId;
  const accountIds = reports.map((report) => /^account:([a-f\d]{24})(?::kitchen)?$/i.exec(report.slackUserId)?.[1]).filter(Boolean);
  const [schedule, users] = await Promise.all([
    nowstaId ? NowstaScheduleEntry.findOne({ nowstaEventId: nowstaId }).select('title archived shifts').lean() : event?.meta?.nowsta,
    accountIds.length ? User.find({ _id: { $in: accountIds } }).select('email username nowstaName').lean() : [],
  ]);
  return { event, schedule, users, reports,
    configuredRecipients: settings?.emailEnabled ? (settings.recipients || []).map((recipient) => recipient.email) : [] };
};

let running = false;
export const runEventReportDigests = async () => {
  if (running) return;
  running = true;
  try {
    // Only submissions marked by the new code create jobs: never mass-mail historical reports.
    const pending = await EventReport.find({ digestRequested: true, status: 'submitted' }).select('_id eventId').limit(100).lean();
    for (const report of pending) {
      try {
        await EventReportDigest.updateOne({ _id: report.eventId }, { $setOnInsert: { status: 'waiting', nextAttemptAt: new Date() } }, { upsert: true });
      } catch (error) { if (error.code !== 11000) throw error; }
      await EventReport.updateOne({ _id: report._id, digestRequested: true }, { $set: { digestRequested: false } });
    }
    for (let index = 0; index < 10; index += 1) {
      const lockToken = crypto.randomUUID();
      const now = new Date();
      const job = await EventReportDigest.findOneAndUpdate({ status: { $in: ['waiting', 'queued', 'processing'] },
        nextAttemptAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { status: 'processing', lockToken, lockedUntil: new Date(+now + 15 * 60_000) } },
      { new: true, sort: { nextAttemptAt: 1 } }).select('+payload').lean();
      if (!job) break;
      const save = async (fields) => {
        const result = await EventReportDigest.updateOne({ _id: job._id, lockToken, lockedUntil: { $gt: new Date() } }, { $set: fields });
        return result.matchedCount === 1;
      };
      try { await processEventDigest(job, { load: loadDigestContext, save }); }
      finally { await EventReportDigest.updateOne({ _id: job._id, lockToken }, { $set: { lockToken: '', lockedUntil: null } }); }
    }
  } finally { running = false; }
};
