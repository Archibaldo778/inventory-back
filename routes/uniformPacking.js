import { Router } from 'express';
import mongoose from 'mongoose';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import Staff from '../models/Staff.js';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import { requireRoles } from '../middleware/auth.js';
import { sendApiError } from '../utils/apiErrors.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { UNIFORM_PACKING_ROLES, uniformStaffing, buildUniformRoster, validateUniformLines,
  importUniformRoster, uniformRosterCsv } from '../utils/uniformPacking.js';

const router = Router();
router.use(requireRoles(UNIFORM_PACKING_ROLES));
router.use(createMemoryRateLimiter({ windowMs: 60_000, max: 60, skipSafeMethods: true }));
const dateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDate = (value, days) => new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
const eventFields = 'nowstaEventId externalId title client date venue address shifts lastSyncedAt';
const getEntry = (id) => NowstaScheduleEntry.findOne({ nowstaEventId: String(id), archived: { $ne: true }, entryType: 'event' }).select(eventFields).lean();
const summary = (entry) => ({ id: entry.nowstaEventId, title: entry.title, date: entry.date, client: entry.client,
  venue: entry.venue, address: entry.address, lastSyncedAt: entry.lastSyncedAt, ...uniformStaffing(entry) });
const blankPackout = (id) => ({ nowstaEventId: id, revision: 0, lines: [], notes: '', rosterSizes: [], rosterImport: null });
const staffFields = 'firstName lastName nowstaName nowstaCompanyUserId jacketSize shirtSize pantsSize shoeSize height';
const errorResponse = (res, error) => sendApiError(res, error, { field: 'message', context: 'Uniform packing failed', fallbackMessage: 'Unable to load or save uniform packing' });

export const saveUniformPackout = async (id, expectedRevision, changes, actor, Model = UniformPackout) => {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw Object.assign(new Error('Reload the event before saving'), { statusCode: 400 });
  const update = { ...changes, updatedBy: actor };
  let saved;
  if (expectedRevision === 0) {
    try { saved = await Model.create({ nowstaEventId: id, ...update, revision: 1 }); }
    catch (error) { if (error.code !== 11000) throw error; }
  } else {
    saved = await Model.findOneAndUpdate({ nowstaEventId: id, revision: expectedRevision }, { $set: update, $inc: { revision: 1 } }, { new: true, runValidators: true });
  }
  if (!saved) throw Object.assign(new Error('Another person changed this packout. Reload the event before saving your changes.'), { statusCode: 409 });
  return saved;
};

const linkedEvent = async (entry) => {
  const query = { 'meta.nowsta.excluded': { $ne: true }, status: { $nin: ['deleted', 'cancelled', 'canceled', 'archived'] } };
  const direct = await Event.find({ ...query, 'meta.nowsta.apiEventId': entry.nowstaEventId }).select('_id').limit(2).lean();
  if (direct.length) return direct.length === 1 ? direct[0] : null;
  if (!entry.externalId) return null;
  const matches = await Event.find({ ...query, externalId: entry.externalId, date: entry.date }).select('_id').limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
};

router.get('/events', async (req, res) => {
  try {
    const from = String(req.query.from || shiftDate(today(), -14));
    const to = String(req.query.to || shiftDate(today(), 60));
    if (!dateString(from) || !dateString(to) || from > to || Date.parse(to) - Date.parse(from) > 120 * 86400000) {
      return res.status(400).json({ message: 'Choose a valid date range of up to 120 days' });
    }
    const entries = await NowstaScheduleEntry.find({ archived: { $ne: true }, entryType: 'event', date: { $gte: from, $lte: to } }).select(eventFields).sort({ date: 1, title: 1 }).lean();
    const packouts = await UniformPackout.find({ nowstaEventId: { $in: entries.map((entry) => entry.nowstaEventId) } }).select('nowstaEventId lines updatedAt updatedBy').lean();
    const byEvent = new Map(packouts.map((packout) => [packout.nowstaEventId, packout]));
    return res.json({ items: entries.map((entry) => {
      const packed = byEvent.get(entry.nowstaEventId);
      return { ...summary(entry), sentQuantity: (packed?.lines || []).reduce((sum, line) => sum + line.quantity, 0), packingUpdatedAt: packed?.updatedAt, packingUpdatedBy: packed?.updatedBy };
    }), from, to });
  } catch (error) { return errorResponse(res, error); }
});

router.get('/events/:id', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const [packout, staff, catalog] = await Promise.all([
      UniformPackout.findOne({ nowstaEventId: entry.nowstaEventId }).lean(), Staff.find({}).select(staffFields).lean(),
      UniformItem.find({ hidden: { $ne: true } }).select('name sizes color category image imageUrl location').sort({ name: 1 }).lean(),
    ]);
    return res.json({ event: summary(entry), roster: buildUniformRoster(entry, staff, packout?.rosterSizes), packout: packout || blankPackout(entry.nowstaEventId), catalog });
  } catch (error) { return errorResponse(res, error); }
});

router.put('/events/:id/packout', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const catalog = await UniformItem.find({ hidden: { $ne: true } }).select('name sizes hidden').lean();
    const lines = validateUniformLines(req.body?.lines, catalog);
    const notes = String(req.body?.notes || '').trim().slice(0, 3000);
    const saved = await saveUniformPackout(entry.nowstaEventId, req.body?.expectedRevision, { lines, notes }, req.auth.username || req.auth.userId);
    return res.json(saved);
  } catch (error) { return errorResponse(res, error); }
});

router.post('/events/:id/roster-import', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const [packout, staff] = await Promise.all([UniformPackout.findOne({ nowstaEventId: entry.nowstaEventId }).lean(), Staff.find({}).select(staffFields).lean()]);
    const roster = buildUniformRoster(entry, staff, packout?.rosterSizes);
    const imported = importUniformRoster(req.body?.csv, entry, roster);
    const merged = new Map((packout?.rosterSizes || []).map((row) => [row.key, row]));
    imported.sizes.forEach((row) => merged.set(row.key, { ...merged.get(row.key), ...row }));
    const saved = await saveUniformPackout(entry.nowstaEventId, req.body?.expectedRevision, {
      rosterSizes: [...merged.values()], rosterImport: { fileName: String(req.body?.fileName || 'Roster.csv').slice(0, 200),
        importedAt: new Date(), importedBy: req.auth.username || req.auth.userId, dress: imported.dress },
    }, req.auth.username || req.auth.userId);
    return res.json({ packout: saved, roster: buildUniformRoster(entry, staff, saved.rosterSizes), unmatched: imported.unmatched });
  } catch (error) { return errorResponse(res, error); }
});

router.get('/events/:id/roster.csv', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const [packout, staff] = await Promise.all([UniformPackout.findOne({ nowstaEventId: entry.nowstaEventId }).lean(), Staff.find({}).select(staffFields).lean()]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${entry.date}-Staffing-Roster.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(uniformRosterCsv(entry, buildUniformRoster(entry, staff, packout?.rosterSizes), packout?.rosterImport?.dress || ''));
  } catch (error) { return errorResponse(res, error); }
});

router.get('/events/:id/boards', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const event = await linkedEvent(entry);
    if (!event) return res.json({ boards: [] });
    const decks = await Deck.find({ eventId: event._id, type: { $in: ['decor', 'uniform'] } }).select('_id title type').lean();
    const pages = await Page.find({ deckId: { $in: decks.map((deck) => deck._id) }, deletedAt: null }).select('_id deckId index revision updatedAt').sort({ index: 1 }).lean();
    return res.json({ boards: decks.map((deck) => ({ id: String(deck._id), title: deck.title || deck.type, type: deck.type,
      pages: pages.filter((page) => String(page.deckId) === String(deck._id)).map((page) => ({ id: String(page._id), index: page.index, revision: page.revision })) })) });
  } catch (error) { return errorResponse(res, error); }
});

router.get('/events/:id/boards/:pageId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.pageId)) return res.status(400).json({ message: 'Invalid board page' });
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const event = await linkedEvent(entry);
    if (!event) return res.status(404).json({ message: 'No linked event board' });
    const decks = await Deck.find({ eventId: event._id, type: { $in: ['decor', 'uniform'] } }).select('_id').lean();
    const page = await Page.findOne({ _id: req.params.pageId, deckId: { $in: decks.map((deck) => deck._id) }, deletedAt: null }).select('preview revision').lean();
    if (!page) return res.status(404).json({ message: 'Board page not found' });
    return res.json({ preview: /^data:image\/(?:png|jpeg|webp);base64,/.test(page.preview || '') ? page.preview : '', revision: page.revision });
  } catch (error) { return errorResponse(res, error); }
});

export default router;
