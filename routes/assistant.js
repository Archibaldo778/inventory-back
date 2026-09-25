import { Router } from 'express';
import mongoose from 'mongoose';
import AssistantIssue from '../models/AssistantIssue.js';
import AssistantThread from '../models/AssistantThread.js';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import Product from '../models/Product.js';
import { isAdminAuth } from '../middleware/auth.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { askOccAssistant, likelySiteIssue } from '../utils/assistantAi.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const messageRateLimit = createMemoryRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many assistant messages. Wait a few minutes and try again.',
});
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const regexEscape = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INVENTORY_STOP_WORDS = new Set([
  'this', 'that', 'with', 'have', 'from', 'your', 'event', 'please', 'look', 'check',
  'этот', 'этого', 'ивент', 'сейчас', 'посмотри', 'проверь', 'добавь', 'нужно', 'который',
]);
const decorInventoryScope = {
  $or: [
    { inventoryType: 'decor' },
    { inventoryType: { $exists: false } },
    { inventoryType: '' },
  ],
};

const isOwner = (auth) => {
  const configured = String(process.env.OCC_ASSISTANT_OWNER_EMAILS || 'ivan@ocnyc.com,itsupport@ocnyc.com')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return configured.includes(clean(auth?.email, 320).toLowerCase()) || clean(auth?.username, 100).toLowerCase() === 'ivan';
};

const managerMatches = (event, auth) => {
  if (isAdminAuth(auth)) return true;
  const identities = [auth?.username, auth?.email].map((value) => clean(value, 320).toLowerCase()).filter(Boolean);
  const managers = [event?.managerId, event?.meta?.salesRep, event?.meta?.salesRepName, event?.meta?.managerName]
    .map((value) => clean(value, 320).toLowerCase()).filter(Boolean);
  return identities.some((person) => managers.some((manager) => manager === person || manager.includes(person) || person.includes(manager)));
};

const serializeMessage = (message) => ({
  id: String(message?._id || ''),
  role: message?.role === 'assistant' ? 'assistant' : 'user',
  content: clean(message?.content, 12000),
  context: message?.context || {},
  createdAt: message?.createdAt || null,
});

const serializeIssue = (issue) => ({
  id: String(issue?._id || ''), summary: clean(issue?.summary, 500), message: clean(issue?.message, 4000),
  severity: issue?.severity || 'medium', reporterName: clean(issue?.reporterName, 200),
  reporterEmail: clean(issue?.reporterEmail, 320), path: clean(issue?.path, 1000),
  eventId: issue?.eventId ? String(issue.eventId) : '', createdAt: issue?.createdAt || null,
});

const boundedAnswers = (answers) => Object.fromEntries(
  Object.entries(answers && typeof answers === 'object' ? answers : {})
    .slice(0, 60)
    .map(([key, value]) => [clean(key, 120), clean(value, 1500)])
    .filter(([key, value]) => key && value),
);

// Company-wide venue facts are useful across events. Client, event, report, and
// staff details are included only when the event belongs to the requester or an admin.
const eventContextFor = (event, auth) => {
  if (!event) return null;
  const venue = {
    venue: clean(event?.meta?.venue || event?.meta?.nowsta?.venue, 300),
    address: clean(event?.meta?.address || event?.meta?.nowsta?.address, 600),
    serviceEntrance: clean(event?.meta?.serviceEntrance, 600),
    venueNotes: clean(event?.meta?.venueNotes, 2000),
  };
  if (!managerMatches(event, auth)) return { scope: 'venue_only', ...venue };
  return {
    scope: 'related_event', id: String(event._id), title: clean(event.title, 300),
    date: clean(event.date, 40), client: clean(event.client, 300),
    manager: clean(event.managerId || event?.meta?.salesRep, 300), ...venue,
  };
};

const loadActiveEvent = async (eventId) => {
  if (!mongoose.Types.ObjectId.isValid(clean(eventId, 80))) return null;
  return Event.findById(eventId).select('title date client managerId meta').lean();
};

const digestFor = async (auth, since) => {
  const cutoff = since || new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const candidates = await Event.find({ updatedAt: { $gt: cutoff }, status: { $not: /^deleted$/i } })
    .select('title date managerId meta updatedAt').sort({ updatedAt: -1 }).limit(100).lean();
  const visibleEvents = candidates.filter((event) => managerMatches(event, auth));
  const visibleIds = visibleEvents.map((event) => event._id);
  const reports = visibleIds.length ? await EventReport.find({
    eventId: { $in: visibleIds }, status: 'submitted', submittedAt: { $gt: cutoff },
  }).select('eventId eventTitle reportType reporterName submittedAt').sort({ submittedAt: -1 }).limit(30).lean() : [];
  return {
    since: cutoff,
    eventUpdates: visibleEvents.slice(0, 8).map((event) => ({
      eventId: String(event._id), title: clean(event.title, 300), date: clean(event.date, 40), updatedAt: event.updatedAt,
    })),
    reports: reports.map((report) => ({
      eventId: String(report.eventId), eventTitle: clean(report.eventTitle, 300), reportType: report.reportType,
      reporterName: clean(report.reporterName, 200), submittedAt: report.submittedAt,
    })),
  };
};

router.get('/bootstrap', async (req, res) => {
  try {
    const now = new Date();
    const thread = await AssistantThread.findOne({ userId: req.auth.userId }).lean();
    const [digest, issues] = await Promise.all([
      digestFor(req.auth, thread?.lastDigestSeenAt || null),
      isOwner(req.auth) ? AssistantIssue.find({ status: 'open' }).sort({ createdAt: -1 }).limit(30).lean() : [],
    ]);
    await AssistantThread.findOneAndUpdate(
      { userId: req.auth.userId },
      { $set: { lastDigestSeenAt: now }, $setOnInsert: { userId: req.auth.userId, messages: [] } },
      { upsert: true },
    );
    return res.json({
      configured: Boolean(clean(process.env.OPENAI_API_KEY, 2000)),
      owner: isOwner(req.auth),
      messages: (thread?.messages || []).slice(-50).map(serializeMessage),
      digest,
      issues: issues.map(serializeIssue),
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Assistant bootstrap failed', fallbackMessage: 'Could not load the assistant' });
  }
});

router.get('/issues', async (req, res) => {
  try {
    if (!isOwner(req.auth)) return res.status(403).json({ message: 'Assistant owner access required' });
    const issues = await AssistantIssue.find({ status: 'open' }).sort({ createdAt: -1 }).limit(30).lean();
    return res.json({ items: issues.map(serializeIssue) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Assistant issues load failed', fallbackMessage: 'Could not load website feedback' });
  }
});

router.post('/messages', messageRateLimit, async (req, res) => {
  try {
    const message = clean(req.body?.message, 4000);
    if (!message) return res.status(400).json({ message: 'A message is required' });
    const path = clean(req.body?.context?.path, 1000);
    const activeEvent = await loadActiveEvent(req.body?.context?.eventId);
    const relatedEvent = activeEvent && managerMatches(activeEvent, req.auth);
    const thread = await AssistantThread.findOne({ userId: req.auth.userId }).lean();
    const reports = relatedEvent && isAdminAuth(req.auth)
      ? await EventReport.find({ eventId: activeEvent._id, status: 'submitted' })
        .select('reportType reporterName position answers submittedAt').sort({ submittedAt: -1 }).limit(12).lean()
      : [];
    const recentUserContext = (thread?.messages || []).slice(-12)
      .filter((entry) => entry?.role === 'user')
      .map((entry) => clean(entry?.content, 1000))
      .join(' ');
    const inventorySearchText = `${recentUserContext} ${message}`.slice(-8000);
    const inventoryCodes = [...new Set((inventorySearchText.match(/\bOCC\s*0*\d+\b/gi) || [])
      .map((value) => value.replace(/\s+/g, '').toUpperCase()))];
    const searchTerms = [...new Set(inventorySearchText.toLowerCase().match(/[a-zа-яё0-9-]{4,}/gi) || [])]
      .filter((term) => !INVENTORY_STOP_WORDS.has(term) && !/^occ\d+$/i.test(term))
      .slice(-12);
    const translatedColors = [
      [/золот/i, 'gold'], [/черн/i, 'black'], [/бел/i, 'white'], [/серебр/i, 'silver'],
      [/красн/i, 'red'], [/син/i, 'blue'], [/зелен/i, 'green'], [/розов/i, 'pink'],
    ].filter(([pattern]) => pattern.test(inventorySearchText)).map(([, color]) => color);
    const inventoryNeedle = [...new Set([...searchTerms, ...translatedColors])].map(regexEscape).filter(Boolean);
    const productFields = 'name inventoryCode quantity category material color description';
    const [exactInventory, fuzzyInventory] = await Promise.all([
      inventoryCodes.length ? Product.find({
        $and: [decorInventoryScope, { inventoryCode: { $in: inventoryCodes } }],
      }).select(productFields).limit(12).lean() : [],
      inventoryNeedle.length ? Product.find({
        $and: [decorInventoryScope, {
          $or: ['name', 'inventoryCode', 'description', 'category', 'material', 'color']
            .map((field) => ({ [field]: { $regex: inventoryNeedle.join('|'), $options: 'i' } })),
        }],
      }).select(productFields).limit(40).lean() : [],
    ]);
    const inventoryCandidates = [...new Map([...exactInventory, ...fuzzyInventory]
      .map((item) => [String(item._id), item])).values()].slice(0, 30);
    const answer = await askOccAssistant({
      user: req.auth,
      message,
      history: thread?.messages || [],
      context: {
        path,
        event: eventContextFor(activeEvent, req.auth),
        reports: reports.map((report) => ({
          type: report.reportType, reporter: report.reporterName, position: report.position,
          submittedAt: report.submittedAt, answers: boundedAnswers(report.answers),
        })),
        inventoryCandidates: inventoryCandidates.map((item) => ({
          name: clean(item.name, 200), inventoryCode: clean(item.inventoryCode, 80), available: item.quantity,
          category: clean(item.category, 120), material: clean(item.material, 120),
          color: clean(item.color, 120), description: clean(item.description, 600),
        })),
      },
    });
    const issueDetected = answer.siteIssue.detected || likelySiteIssue(message);
    let issue = null;
    if (issueDetected) {
      issue = await AssistantIssue.create({
        reporterUserId: req.auth.userId, reporterName: clean(req.auth.username, 200),
        reporterEmail: clean(req.auth.email, 320).toLowerCase(), message,
        summary: answer.siteIssue.summary || clean(message, 500), severity: answer.siteIssue.severity,
        path, eventId: relatedEvent ? activeEvent._id : null,
      });
    }
    const now = new Date();
    const messageContext = {
      path, eventId: relatedEvent ? activeEvent._id : null,
      eventTitle: relatedEvent ? clean(activeEvent?.title, 300) : '',
    };
    const saved = await AssistantThread.findOneAndUpdate(
      { userId: req.auth.userId },
      {
        $setOnInsert: { userId: req.auth.userId },
        $push: { messages: { $each: [
          { role: 'user', content: message, context: messageContext, createdAt: now },
          { role: 'assistant', content: answer.reply, context: messageContext, createdAt: now },
        ], $slice: -100 } },
      },
      { upsert: true, new: true },
    );
    return res.json({
      message: serializeMessage(saved.messages[saved.messages.length - 1]),
      uiAction: answer.uiAction,
      issueRecorded: Boolean(issue),
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Assistant message failed', fallbackMessage: 'The assistant could not answer' });
  }
});

router.patch('/issues/:issueId', async (req, res) => {
  try {
    if (!isOwner(req.auth)) return res.status(403).json({ message: 'Assistant owner access required' });
    if (!mongoose.Types.ObjectId.isValid(req.params.issueId)) return res.status(400).json({ message: 'Invalid issue' });
    const status = req.body?.status === 'resolved' ? 'resolved' : 'open';
    const issue = await AssistantIssue.findByIdAndUpdate(req.params.issueId, {
      $set: { status, resolvedAt: status === 'resolved' ? new Date() : null },
    }, { new: true });
    if (!issue) return res.status(404).json({ message: 'Issue was not found' });
    return res.json({ ok: true, status: issue.status });
  } catch (error) {
    return sendApiError(res, error, { context: 'Assistant issue update failed', fallbackMessage: 'Could not update the issue' });
  }
});

export default router;
