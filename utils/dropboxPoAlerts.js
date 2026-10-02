import crypto from 'node:crypto';
import AutomationAlertPolicy from '../models/AutomationAlertPolicy.js';
import AutomationAlertRule from '../models/AutomationAlertRule.js';
import AutomationAlertDelivery from '../models/AutomationAlertDelivery.js';
import DropboxDocument from '../models/DropboxDocument.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import Event from '../models/Event.js';
import { buildAutomationAlertEmail, findAutomationMatches, ensureDefaultAutomationRule } from './automationAlerts.js';
import { getCatereaseConfig } from './catereaseApi.js';
import { nyToday, isDropboxNotesPath } from './dropboxDocuments.js';
import { readDropboxDocxMetadata } from './dropboxDocxMetadata.js';
import { decryptDropboxSecret, refreshDropboxAccessToken, downloadDropboxFile } from './dropboxApi.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const POLICY_ID = 'dropbox-po-schedule-v1';
const HOUR = 60 * 60_000;
const LEASE = 10 * 60_000;
export const PO_REMINDER_HOUR = 8;
export const ensureDropboxPoPolicy = (now = new Date()) => AutomationAlertPolicy.findOneAndUpdate(
  { _id: POLICY_ID }, { $setOnInsert: { activatedAt: now } }, { upsert: true, new: true, setDefaultsOnInsert: true },
);

const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(`${date}T12:00:00Z`))
  && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
export const poEventActive = (event) => validDate(event?.date)
  && event?.meta?.nowsta?.excluded !== true
  && !/cancel|deleted|archived|\blost\b/i.test(`${event?.status || ''} ${event?.catereaseOperations?.eventStatus || ''}`);
const dayBefore = (date) => new Date(Date.parse(`${date}T12:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10);
const newYorkHour = (now) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now));
export const eligiblePoDocument = (doc) => doc?.documentType === 'po' && doc.status === 'imported'
  && doc.isLatestRevision === true && doc.sourceOrigin !== 'occ_generated' && !isDropboxNotesPath(doc.path)
  && !doc.contentInspectionError && doc.contentInspectedRev === doc.rev;
const attachedPoDocuments = (event, documents) => {
  const attached = new Set((event?.documents || []).filter((doc) => doc.sourceProvider === 'dropbox' && doc.type === 'po').map((doc) => String(doc.sourceId)));
  return documents.filter((doc) => attached.has(doc.dropboxId) && eligiblePoDocument(doc));
};

export const planDropboxPoAlert = ({ event, documents, deliveries = [], activatedAt, now = new Date() }) => {
  const today = nyToday(now);
  if (!poEventActive(event) || event.date < today || !documents.length || documents.some((doc) => !eligiblePoDocument(doc))) return null;
  const scheduled = deliveries.filter((entry) => entry.source === 'dropbox_po' && entry.eventDate === event.date);
  const unfinished = scheduled.find((entry) => ['pending', 'failed'].includes(entry.status));
  // An uncertain request must never acquire a new key or outlive Resend's 24h idempotency window.
  if (unfinished) return unfinished.firstAttemptAt && now - new Date(unfinished.firstAttemptAt) < 23 * HOUR ? unfinished.stage : null;
  if (scheduled.some((entry) => entry.stage === 'packing')) return null;
  const packingDay = dayBefore(event.date);
  const sent = deliveries.filter((entry) => entry.status === 'sent');
  if (sent.some((entry) => entry.sentAt && nyToday(new Date(entry.sentAt)) >= packingDay)) return null;
  const arrived = documents.some((doc) => doc.firstSeenAt && activatedAt && new Date(doc.firstSeenAt) >= new Date(activatedAt));
  const hadArrival = scheduled.some((entry) => entry.stage === 'arrival') || sent.length > 0;
  if (today >= packingDay) {
    // A late PO uses the SAME packing key even before 08:00 or on event day.
    if (arrived && !hadArrival) return 'packing';
    if (today === packingDay && newYorkHour(now) >= PO_REMINDER_HOUR) return 'packing';
    return null;
  }
  return arrived && !hadArrival ? 'arrival' : null;
};

export const poDeliverySignature = (event, rule, stage) => crypto.createHash('sha256')
  .update(`dropbox-po-v1|${rule._id}|${event._id}|${event.date}|${stage}`).digest('hex');

export const deliverDropboxPoAlert = async ({ event, rule, matches, stage, now = new Date(),
  Delivery = AutomationAlertDelivery, fetchImpl = globalThis.fetch, apiKey = process.env.RESEND_API_KEY }) => {
  if (!apiKey || !matches.length || !rule.enabled) return 'skipped';
  const signature = poDeliverySignature(event, rule, stage);
  const key = { ruleId: rule._id, eventId: event._id, signature };
  const payload = buildAutomationAlertEmail({ event, rule, matches, stage });
  if (!payload.to.length) return 'skipped';
  try {
    await Delivery.updateOne(key, { $setOnInsert: { ...key, source: 'dropbox_po', stage, eventDate: event.date,
      status: 'pending', payload, recipients: payload.to, matchedItems: matches, firstAttemptAt: now, attempts: 0 } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const job = await Delivery.findOneAndUpdate({ ...key, status: { $in: ['pending', 'failed'] },
    firstAttemptAt: { $gt: new Date(now - 23 * HOUR) },
    $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
  }, { $set: { lockedUntil: new Date(+now + 2 * 60_000), lastAttemptAt: now }, $inc: { attempts: 1 } }, { new: true }).select('+payload');
  if (!job) return 'skipped';
  if (JSON.stringify(job.payload?.to) !== JSON.stringify(payload.to)) {
    job.status = 'cancelled'; job.error = 'Recipients changed; the original delivery was cancelled'; job.lockedUntil = null; await job.save();
    return 'cancelled';
  }
  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `po-alert:${signature}` },
      body: JSON.stringify(job.payload),
    }, { timeoutMs: 20_000, fetchImpl });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error(`PO alert delivery not confirmed (HTTP ${response.status})`);
    job.status = 'sent'; job.providerId = result.id; job.sentAt = new Date(); job.error = '';
  } catch (error) { job.status = 'failed'; job.error = String(error?.message || 'PO email failed').slice(0, 500); }
  job.lockedUntil = null;
  await job.save();
  return job.status;
};

export const loadPoAlertItems = async (doc, loadBuffer, Document = DropboxDocument) => {
  if (doc.poAlertParserVersion === 1 && Array.isArray(doc.poAlertItems)) return doc.poAlertItems;
  const parsed = await readDropboxDocxMetadata(await loadBuffer(doc), { documentType: 'po' });
  if (parsed.documentType !== 'po' || !Array.isArray(parsed.poAlertItems)) throw new Error('PO contents could not be confirmed');
  const updated = await Document.updateOne({ _id: doc._id, rev: doc.rev, status: 'imported', isLatestRevision: true }, {
    $set: { poAlertItems: parsed.poAlertItems, poAlertParserVersion: 1 },
  });
  if (!updated.matchedCount) throw new Error('PO changed while it was being read; wait for the next scan');
  return parsed.poAlertItems;
};

export const runDropboxPoAlerts = async ({ now = new Date() } = {}) => {
  if (getCatereaseConfig().eventDocumentSource !== 'dropbox' || !process.env.RESEND_API_KEY) return { disabled: true };
  const policy = await ensureDropboxPoPolicy(now);
  const integration = await DropboxIntegration.findOne({ provider: 'dropbox' }).select('+refreshToken.ciphertext +refreshToken.iv +refreshToken.tag').lean();
  if (!integration?.enabled || !integration.refreshToken?.ciphertext || integration.lastSyncError
    || !integration.lastSyncCompletedAt || now - new Date(integration.lastSyncCompletedAt) > 30 * 60_000
    || integration.lastSyncStartedAt > integration.lastSyncCompletedAt) return { waitingForDropbox: true };
  const lockOwner = crypto.randomUUID();
  const lease = await AutomationAlertPolicy.findOneAndUpdate({ _id: POLICY_ID,
    $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
  }, { $set: { lockedUntil: new Date(+now + LEASE), lockOwner } }, { new: true });
  if (!lease) return { busy: true };
  const summary = { sent: 0, failed: 0, skipped: 0 };
  const renew = async () => {
    const result = await AutomationAlertPolicy.updateOne({ _id: POLICY_ID, lockOwner }, { $set: { lockedUntil: new Date(Date.now() + LEASE) } });
    if (!result.matchedCount) throw new Error('PO alert worker lease was lost');
  };
  try {
    await ensureDefaultAutomationRule();
    const rules = await AutomationAlertRule.find({ enabled: true, source: 'caterease_packout' }).lean();
    if (!rules.length) return summary;
    const documents = await DropboxDocument.find({ namespaceId: integration.namespaceId, documentType: 'po', status: 'imported',
      isLatestRevision: true, sourceOrigin: { $ne: 'occ_generated' }, importedEventId: { $ne: null }, inferredDate: { $gte: nyToday(now) },
    }).lean();
    const groups = new Map();
    for (const doc of documents) {
      const key = String(doc.importedEventId); groups.set(key, [...(groups.get(key) || []), doc]);
    }
    let accessToken = '';
    const loadBuffer = async (doc) => {
      await renew();
      if (!accessToken) accessToken = await refreshDropboxAccessToken(decryptDropboxSecret(integration.refreshToken));
      return downloadDropboxFile(accessToken, doc.dropboxId, { namespaceId: integration.namespaceId });
    };
    for (const [eventId, eventDocs] of groups) {
      await renew();
      const event = await Event.findById(eventId).select('title date status documents meta.nowsta.excluded catereaseOperations.eventStatus').lean();
      const docs = attachedPoDocuments(event, eventDocs);
      if (!poEventActive(event) || !docs.length) continue;
      let rows;
      for (const rule of rules) {
        const deliveries = await AutomationAlertDelivery.find({ eventId, ruleId: rule._id,
          $or: [{ source: { $ne: 'dropbox_po' } }, { eventDate: event.date }],
        }).select('source stage eventDate status sentAt firstAttemptAt').lean();
        const stage = planDropboxPoAlert({ event, documents: docs, deliveries, activatedAt: policy.activatedAt, now });
        if (!stage) continue;
        try {
          if (!rows) {
            const loadedRows = [];
            for (const doc of docs) loadedRows.push(...await loadPoAlertItems(doc, loadBuffer));
            rows = loadedRows;
          }
          const matches = findAutomationMatches({ packOut: rows }, rule.matchTerms);
          if (!matches.length) continue;
          await renew();
          // Revalidate files and event after downloads, before queuing an email.
          const currentCount = await DropboxDocument.countDocuments({ $or: docs.map((doc) => ({ _id: doc._id, rev: doc.rev,
            importedEventId: event._id, status: 'imported', isLatestRevision: true, sourceOrigin: { $ne: 'occ_generated' } })) });
          const currentEvent = await Event.findById(eventId).select('date status documents meta.nowsta.excluded catereaseOperations.eventStatus').lean();
          const currentRule = await AutomationAlertRule.findById(rule._id).lean();
          if (currentCount !== docs.length || !poEventActive(currentEvent) || currentEvent.date !== event.date || !currentRule?.enabled) continue;
          const currentDocs = await DropboxDocument.find({ namespaceId: integration.namespaceId, importedEventId: event._id,
            documentType: 'po', status: 'imported', isLatestRevision: true, sourceOrigin: { $ne: 'occ_generated' },
          }).select('_id rev dropboxId documentType status isLatestRevision sourceOrigin path contentInspectedRev contentInspectionError').lean();
          const documentKey = (list) => list.map((doc) => `${doc._id}:${doc.rev}`).sort().join('|');
          const currentSync = await DropboxIntegration.findOne({ provider: 'dropbox' }).select('enabled lastSyncStartedAt lastSyncCompletedAt lastSyncError').lean();
          if (documentKey(attachedPoDocuments(currentEvent, currentDocs)) !== documentKey(docs) || !currentSync?.enabled || currentSync.lastSyncError
            || currentSync.lastSyncStartedAt > currentSync.lastSyncCompletedAt) continue;
          if (JSON.stringify(currentRule.matchTerms) !== JSON.stringify(rule.matchTerms)) continue;
          const status = await deliverDropboxPoAlert({ event, rule: currentRule, matches, stage, now });
          summary[status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'skipped'] += 1;
        } catch (error) { summary.failed += 1; console.error('Dropbox PO alert failed:', eventId, error?.message); }
      }
    }
    return summary;
  } finally {
    await AutomationAlertPolicy.updateOne({ _id: POLICY_ID, lockOwner }, { $set: { lockedUntil: null, lockOwner: '' } });
  }
};
