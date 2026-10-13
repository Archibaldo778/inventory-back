import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import BarAiSettings from '../models/BarAiSettings.js';
import BarDocumentRecheck from '../models/BarDocumentRecheck.js';
import DropboxDocument from '../models/DropboxDocument.js';
import CatereaseFile from '../models/CatereaseFile.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import { decryptDropboxSecret, refreshDropboxAccessToken, downloadDropboxFile, getDropboxMetadata } from './dropboxApi.js';
import { downloadCatereaseEventFile } from './catereaseApi.js';
import { readDropboxDocxMetadata } from './dropboxDocxMetadata.js';
import { inspectBarDocument } from './barDocumentAiService.js';
import { normalizePackoutItems } from '../routes/bar.js';
import { selectDropboxBarSourceDocuments } from './dropboxBarSync.js';
import { prepareBarDocumentRecheck, protectedBarRecheckReason, recheckSourceSignature, canCommitBarRecheck, barDocumentRecheckQuery } from './barDocumentRecheckPlan.js';

const sourceDocuments = (event) => (event.documents || []).filter((d) => ['dropbox', 'caterease'].includes(d.sourceProvider) && ['po', 'kitchen_menu'].includes(d.type));
const chooseDocuments = (documents) => [...selectDropboxBarSourceDocuments(documents), ...documents.filter((d) => d.sourceProvider === 'caterease')];
const sameSource = (a, b) => String(a._id) === String(b._id) || (a.type === b.type && a.checksum && a.checksum === b.checksum);
let running = null;

async function runBatch() {
  if (!process.env.OPENAI_API_KEY) return { disabled: true };
  const now = new Date();
  const settings = await BarAiSettings.findById('bar').lean();
  const rulesRevision = settings?.revision || 0;
  const bars = await BarEvent.find(barDocumentRecheckQuery()).lean();
  const events = await Event.find({ _id: { $in: bars.map((b) => b.linkedEventId) }, status: { $not: /^(?:deleted|cancelled|canceled|lost)$/i }, 'meta.nowsta.excluded': { $ne: true }, 'documents.0': { $exists: true } }).select('title date documents').lean();
  const byId = new Map(events.map((e) => [String(e._id), e]));
  const jobs = await BarDocumentRecheck.find({ _id: { $in: events.map((e) => e._id) } }).lean();
  const jobById = new Map(jobs.map((j) => [String(j._id), j]));
  const candidates = bars.flatMap((bar) => {
    const event = byId.get(String(bar.linkedEventId));
    if (!event || protectedBarRecheckReason(bar)) return [];
    const documents = sourceDocuments(event);
    // Office uploads remain authoritative; do not combine them with stale automatic sources.
    if (!documents.length || documents.length !== event.documents.length) return [];
    const signature = recheckSourceSignature(documents, rulesRevision);
    const job = jobById.get(String(event._id));
    if (job?.lockedUntil > now || (job?.signature === signature && (['done', 'protected', 'needs_review'].includes(job.status) || job.nextAttemptAt > now))) return [];
    return [{ bar, event, documents, signature, job }];
  }).sort((a, b) => {
    const priority = (x) => x.bar.sourceChangedAfterReturns ? -1 : (x.bar.items?.length > 0 && x.bar.items?.some((i) => i.sentQtyPending)) ? 0 : 1;
    return priority(a) - priority(b) || Math.abs(+new Date(a.event.date) - +now) - Math.abs(+new Date(b.event.date) - +now);
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
      const current = await getDropboxMetadata(dropbox.token, document.sourceId, { namespaceId: dropbox.namespaceId });
      if (document.sourceRevision && current.rev !== document.sourceRevision) throw new Error('Source revision changed; waiting for regular Dropbox sync');
      buffer = await downloadDropboxFile(dropbox.token, document.sourceId, { namespaceId: dropbox.namespaceId });
      const after = await getDropboxMetadata(dropbox.token, document.sourceId, { namespaceId: dropbox.namespaceId });
      if (after.rev !== current.rev) throw new Error('Source revision changed during download');
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
      const plan = await prepareBarDocumentRecheck({ bar, documents: chooseDocuments(documents), read, normalize: normalizePackoutItems });
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
            await BarEvent.updateOne({ _id: bar._id, revision: bar.revision }, { $set: { importReview: { status: 'needs_review', issues: plan.issues || [plan.reason] } }, $inc: { revision: 1 } }, { session });
          } else {
            const replacements = event.documents.map((d) => {
              const parsed = plan.documents.find((p) => sameSource(d, p));
              return parsed ? { ...d, barItems: parsed.barItems, barReview: parsed.barReview } : d;
            });
            const savedEvent = await Event.updateOne({ _id: event._id, documents: freshEvent.documents }, { $set: { documents: replacements } }, { session });
            if (savedEvent.matchedCount !== 1) throw new Error('Source documents changed during inspection');
            for (const document of replacements) {
              if (!document.barReview) continue;
              const Model = document.sourceProvider === 'dropbox' ? DropboxDocument : CatereaseFile;
              const filter = document.sourceProvider === 'dropbox' ? { dropboxId: document.sourceId, rev: document.sourceRevision } : { uid: document.sourceId };
              await Model.updateOne(filter, { $set: { barItems: document.barItems, barReview: document.barReview } }, { session });
            }
            await BarEvent.updateOne({ _id: bar._id, revision: bar.revision }, {
              $set: { items: plan.items, status: bar.status === 'draft' ? 'ready' : bar.status },
              $unset: { importReview: '', sourceChangedAfterReturns: '' }, $inc: { revision: 1 },
              $push: { audit: { $each: [{ action: 'document_ai_rechecked', username: 'Automatic document recheck', at: new Date(), details: { signature, before: bar.items?.length || 0, after: plan.items.length } }], $slice: -200 } },
            }, { session, runValidators: true });
          }
          await BarDocumentRecheck.updateOne({ _id: event._id, lease }, { $set: { status: plan.status === 'ready' ? 'done' : plan.status, lockedUntil: null, nextAttemptAt: plan.status === 'retry' ? new Date(Date.now() + 30 * 60_000) : null, message: (plan.issues || []).join('; ').slice(0, 1000) } }, { session });
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
