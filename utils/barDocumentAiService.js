import crypto from 'node:crypto';
import BarAiSettings from '../models/BarAiSettings.js';
import BarAiDocument from '../models/BarAiDocument.js';
import { BAR_AI_VERSION, generateBarDocument } from './barDocumentAi.js';
const pending = new Map();
export async function inspectBarDocument(input) {
  const settings = await BarAiSettings.findById('bar').lean();
  const revision = settings?.revision || 0;
  const key = crypto.createHash('sha256').update(JSON.stringify({ ...input, revision, version: BAR_AI_VERSION, model: process.env.BAR_DOCUMENT_AI_MODEL || 'gpt-5.6-luna' })).digest('hex');
  const cached = await BarAiDocument.findById(key).lean();
  if (cached?.result) return cached.result;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const result = { ...await generateBarDocument({ ...input, rules: settings?.rules || '' }), rulesRevision: revision };
    if (result.status === 'verified') await BarAiDocument.updateOne({ _id: key }, { $setOnInsert: { result, createdAt: new Date() } }, { upsert: true });
    return result;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

// Failed inspection blocks automatic replacement, while preserving the original document.
export async function inspectBarMetadata(metadata, text, inspect = inspectBarDocument) {
  try {
    const result = await inspect({ text, documentType: metadata.documentType, baseline: metadata.barItems || [] });
    return { ...metadata, barItems: result.status === 'verified' ? result.items : [],
      barReview: { status: result.status, issues: result.issues, rulesRevision: result.rulesRevision || 0 } };
  } catch (error) {
    return { ...metadata, barItems: [], barReview: { status: 'needs_review', issues: [String(error.message || 'AI inspection failed').slice(0, 300)] } };
  }
}
