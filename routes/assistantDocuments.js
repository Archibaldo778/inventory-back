import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import AssistantThread from '../models/AssistantThread.js';
import BarAiSettings from '../models/BarAiSettings.js';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import { requireDocumentTeacher } from '../utils/assistantDocumentAccess.js';
import { prepareAssistantAttachments, ASSISTANT_FILE_LIMIT } from '../utils/assistantAttachments.js';
import { askDocumentAssistant } from '../utils/assistantDocumentAi.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.use(requireDocumentTeacher);
router.use(createMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 30, message: 'Too many document requests. Please wait a few minutes.' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: ASSISTANT_FILE_LIMIT, fields: 3, fieldSize: 6000, parts: 8 } }).array('files', 5);
const receive = (req, res, next) => upload(req, res, (error) => error
  ? res.status(400).json({ message: 'Attach up to 5 files, no larger than 8 MB each, with a short message.' }) : next());
const serialize = (message) => ({ id: String(message._id), role: message.role, content: message.content, context: message.context, createdAt: message.createdAt });

export async function documentChatMessage(req, res, next, { ask = askDocumentAssistant } = {}) {
  try {
    const message = String(req.body?.message || '').trim();
    if (message.length > 4000 || (!message && !req.files?.length)) return res.status(400).json({ message: 'Add a message or file (message limit: 4,000 characters)' });
    let eventId = String(req.body?.eventId || '').trim();
    const path = String(req.body?.path || '').slice(0, 1000);
    if (eventId && !mongoose.isValidObjectId(eventId)) return res.status(400).json({ message: 'Invalid event' });
    const attachments = await prepareAssistantAttachments(req.files || []);
    const barPath = path.split('?')[0].match(/^\/bar\/events\/(linked\/)?([a-f0-9]{24})\/?$/i);
    const barFields = 'linkedEventId name eventDate status items.name items.sentQty items.sentQtyPending items.returnConfirmed importReview';
    let bar = null;
    if (barPath?.[1]) {
      if (eventId && eventId !== barPath[2]) return res.status(400).json({ message: 'Event context does not match the current page' });
      eventId = barPath[2];
    } else if (barPath) {
      bar = await BarEvent.findById(barPath[2]).select(barFields).lean();
      if (!bar) return res.status(404).json({ message: 'Bar event not found' });
      if (eventId && eventId !== String(bar.linkedEventId || '')) return res.status(400).json({ message: 'Event context does not match the current page' });
      eventId = String(bar.linkedEventId || '');
    }
    const event = eventId ? await Event.findById(eventId).select('title date').lean() : null;
    if (eventId && !event) return res.status(404).json({ message: 'Event not found' });
    if (!bar && eventId) bar = await BarEvent.findOne({ linkedEventId: eventId }).select(barFields).lean();
    const settings = await BarAiSettings.findById('bar').lean();
    const thread = await AssistantThread.findOne({ userId: req.auth.userId }).lean();
    const history = (thread?.messages || []).filter((entry) => entry.context?.documentMode
      && String(entry.context?.eventId || '') === eventId
      && (eventId || String(entry.context?.barEventId || '') === String(bar?._id || ''))).slice(-12).map((entry) => ({
      role: entry.role, content: entry.content, documentNotes: entry.context?.documentNotes || '',
      files: entry.context?.attachmentNames || [], ruleSaved: entry.context?.ruleSaved === true,
    }));
    const answer = await ask({ message: message || 'Read these attachments and explain the relevant PO items and quantities.', history,
      context: { event, bar, note: 'Bar items are the current stored import, not a new reading of the original PO. Only the attached files were read now.' },
      rules: settings?.rules || '', content: attachments.content });
    const context = { documentMode: true, eventId: event?._id || null, barEventId: bar?._id || null, eventTitle: event?.title || bar?.name || '', path };
    const now = new Date();
    const saved = await AssistantThread.findOneAndUpdate({ userId: req.auth.userId }, {
      $setOnInsert: { userId: req.auth.userId },
      $push: { messages: { $each: [
        { role: 'user', content: message || 'Please read the attached files.', context: { ...context, attachmentNames: attachments.names, documentNotes: answer.documentNotes }, createdAt: now },
        { role: 'assistant', content: answer.reply, context: { ...context, ...(answer.proposedRule ? { ruleProposal: { rule: answer.proposedRule, revision: settings?.revision || 0 }, ruleSaved: false } : {}) }, createdAt: now },
      ], $slice: -100 } },
    }, { upsert: true, new: true });
    return res.json({ message: serialize(saved.messages.at(-1)), userMessage: serialize(saved.messages.at(-2)) });
  } catch (error) { return next(error); }
}

export async function rememberDocumentRule(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: 'Invalid proposal' });
    const thread = await AssistantThread.findOne({ userId: req.auth.userId }).lean();
    const message = thread?.messages?.find((entry) => String(entry._id) === req.params.messageId && entry.role === 'assistant' && entry.context?.documentMode);
    const proposal = message?.context?.ruleProposal;
    if (!proposal?.rule) return res.status(404).json({ message: 'Rule proposal not found in your conversation' });
    const settings = await BarAiSettings.findById('bar').lean();
    const alreadySaved = message.context.ruleSaved || settings?.audit?.some((entry) => entry.proposalId === req.params.messageId);
    if (!alreadySaved) {
      if ((settings?.revision || 0) !== proposal.revision) return res.status(409).json({ message: 'Rules changed since this proposal. Ask the assistant to propose it again using the current rules.' });
      const rules = [settings?.rules?.trim(), proposal.rule.trim()].filter(Boolean).join('\n\n');
      if (rules.length > 16000) return res.status(400).json({ message: 'The rules are full. Ask an account owner to consolidate existing rules first.' });
      const audit = { at: new Date(), userId: String(req.auth.userId), username: String(req.auth.username || ''), rules, proposalId: req.params.messageId, action: 'chat_rule_saved' };
      const saved = await BarAiSettings.findOneAndUpdate({ _id: 'bar', revision: proposal.revision }, {
        $set: { rules }, $inc: { revision: 1 }, $push: { audit: { $each: [audit], $slice: -100 } },
      }, { new: true, upsert: proposal.revision === 0, setDefaultsOnInsert: false });
      if (!saved) return res.status(409).json({ message: 'Rules changed. Ask the assistant for a fresh proposal.' });
    }
    await AssistantThread.updateOne({ userId: req.auth.userId, 'messages._id': message._id }, { $set: { 'messages.$.context.ruleSaved': true } });
    return res.json({ saved: true, rule: proposal.rule });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Rules changed. Ask the assistant for a fresh proposal.' });
    return next(error);
  }
}
router.post('/messages', receive, (req, res, next) => documentChatMessage(req, res, next));
router.post('/rules/:messageId/remember', rememberDocumentRule);
export default router;
