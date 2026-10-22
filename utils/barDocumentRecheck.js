import { downloadDropboxDocumentSnapshot } from './dropboxDocumentSnapshot.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import BarAiSettings from '../models/BarAiSettings.js';
import BarDocumentRecheck from '../models/BarDocumentRecheck.js';
import DropboxDocument from '../models/DropboxDocument.js';
import CatereaseFile from '../models/CatereaseFile.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import { decryptDropboxSecret, refreshDropboxAccessToken } from './dropboxApi.js';
import { downloadCatereaseEventFile } from './catereaseApi.js';
import { readDropboxDocxMetadata } from './dropboxDocxMetadata.js';
import { inspectBarDocument } from './barDocumentAiService.js';
import { normalizePackoutItems } from '../routes/bar.js';
import { prepareBarDocumentRecheck, selectAutomaticRecheckSources, protectedBarRecheckReason, recheckSourceSignature, canCommitBarRecheck, barDocumentRecheckQuery } from './barDocumentRecheckPlan.js';

const sameSource = (a, b) => String(a._id) === String(b._id) || (a.type === b.type && a.checksum && a.checksum === b.checksum);
let running = null;

async function runBatch() {
  if (!process.env.OPENAI_API_KEY) return { disabled: true };
  const now = new Date();
  const settings = await BarAiSettings.findById('bar').lean();
  const rulesRevision = settings?.revision || 0;
  const bars = await BarEvent.find(barDocumentRecheckQuery(now)).lean();
  const events = await Event.find({ _id: { $in: bars.map((b) => b.linkedEventId) }, status: { $not: /^(?:deleted|cancelled|canceled|lost)$/i }, 'meta.nowsta.excluded': { $ne: true }, 'documents.0': { $exists: true } }).select('title date documents').lean();
  const byId = new Map(events.map((e) => [String(e._id), e]));
  const jobs = await BarDocumentRecheck.find({ _id: { $in: events.map((e) => e._id) } }).lean();
  const jobById = new Map(jobs.map((j) => [String(j._id), j]));
  const candidates = bars.flatMap((bar) => {
    const event = byId.get(String(bar.linkedEventId));
    if (!event || protectedBarRecheckReason(bar)) return [];
    const documents = selectAutomaticRecheckSources(event.documents, bar);
    if (!documents.length) return [];
    const signature = recheckSourceSignature(documents, rulesRevision);
    const job = jobById.get(String(event._id));
    if (job?.lockedUntil > now || (job?.signature === signature && (['done', 'protected', 'needs_review'].includes(job.status) || job.nextAttemptAt > now))) return [];
    return [{ bar, event, documents, signature, job }];
  }).sort((a, b) => {
    return String(a.event.date).localeCompare(String(b.event.date)) || Number(b.bar.importReview?.status === 'needs_review') - Number(a.bar.importReview?.status === 'needs_review');
  });
  let dropbox;
  const read = async (document) => {
    let buffer;
    if (document.sourceProvider === 'dropbox') {
      if (!dropbox) {
        const integration = await DropboxIntegration.findOne({ provider: 'dropbox', enabled: { $ne: false } }).select('+refreshToken.ciphertext +refreshToken.iv +refreshToken.tag');
        if (!integration) throw new Error('Dropbox is not connected');
        dropbox = { token: await refreshDropboxAccessToken(decryptDropboxSecret(integration.refreshToken)), namespaceId: integration.namespaceId };
      }
      buffer = await downloadDropboxDocumentSnapshot(dropbox.token, document, dropbox.namespaceId);
    } else buffer = (await downloadCatereaseEventFile(document.sourceId)).buffer;
    return readDropboxDocxMetadata(buffer, { documentType: document.type, inspectBar: inspectBarDocument });
  };
  const summary = { queued: candidates.length, updated: 0, review: 0, failed: 0 };
  for (const candidate of candidates.slice(0, 3)) {
    const { bar, event, documents, signature } = candidate;
    const lease = crypto.randomUUID();
    const attempts = candidate.job?.signature === signature ? (candidate.job.attempts || 0) + 1 : 1;
    try {
      const claimed = await BarDocumentRecheck.findOneAndUpdate({ _id: event._id, ...(candidate.job ? { updatedAt: candidate.job.updatedAt } : { status: { $exists: false } }), $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: null }] },
        { $set: { signature, status: 'processing', lease, attempts, lockedUntil: new Date(Date.now() + 30 * 60_000) } }, { upsert: true, new: true });
      if (!claimed) continue;
      const plan = await prepareBarDocumentRecheck({ bar, documents, read, normalize: normalizePackoutItems,
        onDocument: async () => {
          const renewed = await BarDocumentRecheck.updateOne({ _id: event._id, lease, lockedUntil: { $gt: new Date() } },
            { $set: { lockedUntil: new Date(Date.now() + 30 * 60_000) } });
          if (renewed.matchedCount !== 1) throw new Error('Inspection lease expired');
        },
      });
      if (plan.status === 'retry' && attempts >= 3) plan.status = 'needs_review';
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const freshBar = await BarEvent.findById(bar._id).session(session).lean();
          const freshEvent = await Event.findById(event._id).session(session).lean();
          const freshRules = await BarAiSettings.findById('bar').session(session).lean();
          if (!freshEvent || !canCommitBarRecheck({ beforeBar: bar, currentBar: freshBar, beforeDocuments: event.documents,
            currentDocuments: freshEvent.documents, rulesRevision: freshRules?.revision || 0, signature })) throw new Error('Event changed during inspection; retry with current data');
          const owned = await BarDocumentRecheck.findOne({ _id: event._id, lease }).session(session).lean();
          if (!owned || owned.lockedUntil < new Date()) throw new Error('Inspection lease expired');
          if (plan.status !== 'ready') {
            await BarEvent.updateOne({ _id: bar._id, revision: freshBar.revision }, { $set: { importReview: { status: 'needs_review', issues: plan.issues || [plan.reason] } }, $inc: { revision: 1 } }, { session });
          } else {
            const replacements = event.documents.map((d) => {
              const parsed = plan.documents.find((p) => sameSource(d, p));
              return parsed ? { ...d, barItems: parsed.barItems, barReview: parsed.barReview } : d;
            });
            const savedEvent = await Event.updateOne({ _id: event._id, documents: freshEvent.documents }, { $set: { documents: replacements } }, { session });
            if (savedEvent.matchedCount !== 1) throw new Error('Source documents changed during inspection');
            for (const document of plan.documents) {
              if (!document.barReview || !document.sourceId || !['dropbox', 'caterease'].includes(document.sourceProvider)) continue;
              const Model = document.sourceProvider === 'dropbox' ? DropboxDocument : CatereaseFile;
              const filter = document.sourceProvider === 'dropbox' ? { dropboxId: document.sourceId, rev: document.sourceRevision } : { uid: document.sourceId };
              await Model.updateOne(filter, { $set: { barItems: document.barItems, barReview: document.barReview } }, { session });
            }
            await BarEvent.updateOne({ _id: bar._id, revision: freshBar.revision }, {
              $set: { items: plan.items, packout: { ...plan.packout, importedAt: new Date() }, status: bar.status === 'draft' ? 'ready' : bar.status, ...(plan.review ? { importReview: plan.review } : {}) },
              $unset: { ...(!plan.review ? { importReview: '' } : {}), sourceChangedAfterReturns: '' }, $inc: { revision: 1 },
              $push: { audit: { $each: [{ action: 'document_ai_rechecked', username: 'Automatic document recheck', at: new Date(), details: { signature, before: bar.items?.length || 0, after: plan.items.length } }], $slice: -200 } },
            }, { session, runValidators: true });
          }
          await BarDocumentRecheck.updateOne({ _id: event._id, lease }, { $set: { status: plan.status === 'ready' ? (plan.retryable && attempts < 3 ? 'retry' : 'done') : plan.status, lockedUntil: null, nextAttemptAt: (plan.status === 'retry' || plan.retryable && attempts < 3) ? new Date(Date.now() + 30 * 60_000) : null, message: (plan.issues || []).join('; ').slice(0, 1000) } }, { session });
        });
      } finally { await session.endSession(); }
      if (plan.status === 'ready') summary.updated += 1; else summary.review += 1;
    } catch (error) {
      if (error.code === 11000) continue;
      summary.failed += 1;
      if (!/changed|lease expired/i.test(error.message)) await BarEvent.updateOne({ _id: bar._id, revision: bar.revision, items: bar.items, status: bar.status }, {
        $set: { importReview: { status: 'needs_review', issues: [`Automatic recheck: ${String(error.message).slice(0, 300)}`] } }, $inc: { revision: 1 },
      });
      await BarDocumentRecheck.updateOne({ _id: event._id, lease }, { $set: { status: attempts >= 3 ? 'needs_review' : 'retry', lockedUntil: null, nextAttemptAt: new Date(Date.now() + 30 * 60_000), message: String(error.message).slice(0, 1000) } });
    }
  }
  return summary;
}
export function runBarDocumentRechecks() {
  if (!running) running = runBatch().finally(() => { running = null; });
  return running;
}
