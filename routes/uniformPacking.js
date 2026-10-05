import { Router } from 'express';
import mongoose from 'mongoose';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import Staff from '../models/Staff.js';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import uniformWorkspaceRoutes, { UNIFORM_EVENT_FIELDS } from './uniformWorkspace.js';
import { eventUniformRequirements } from '../utils/uniformRequirements.js';
import { fillMissingNowstaSizes } from '../utils/nowstaUniformSizes.js';
import { validateUniformBags } from '../utils/uniformBags.js';
import { findOrCreatePackingItem } from '../utils/uniformPackingCatalog.js';
import { requireRoles } from '../middleware/auth.js';
import { sendApiError } from '../utils/apiErrors.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { UNIFORM_PACKING_ROLES, uniformStaffing, buildUniformRoster, validateUniformLines,
  importUniformRoster, uniformRosterCsv } from '../utils/uniformPacking.js';

const router = Router();
router.use(requireRoles(UNIFORM_PACKING_ROLES));
router.use('/workspace', uniformWorkspaceRoutes);
router.use(createMemoryRateLimiter({ windowMs: 60_000, max: 60, skipSafeMethods: true }));
const dateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDate = (value, days) => new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
const eventFields = 'nowstaEventId externalId title client date venue address uniform shifts lastSyncedAt';
const getEntry = async (id) => {
  if (!String(id).startsWith('event:')) return NowstaScheduleEntry.findOne({ nowstaEventId: String(id), archived: { $ne: true }, entryType: 'event' }).select(eventFields).lean();
  const eventId = String(id).slice(6);
  if (!mongoose.isValidObjectId(eventId)) return null;
  const event = await Event.findOne({ _id: eventId, status: { $not: /^(deleted|cancelled|canceled|lost|archived)$/i }, 'meta.nowsta.excluded': { $ne: true } }).select(UNIFORM_EVENT_FIELDS).lean();
  if (!event) return null;
  if (event.meta?.nowsta?.apiEventId) {
    const entry = await getEntry(event.meta.nowsta.apiEventId);
    if (entry) return entry;
  }
  return { ...event, nowstaEventId: String(event.meta?.nowsta?.apiEventId || id), venue: event.meta?.venue || '', uniform: event.meta?.nowsta?.uniform || '',
    shifts: event.meta?.nowsta?.shifts?.length ? event.meta.nowsta.shifts : (event.catereaseOperations?.staffRequest || []).map((row) => ({ ...row, workers: [], unfilled: row.required || 0 })) };
};
const summary = (entry) => ({ id: entry.nowstaEventId, title: entry.title, date: entry.date, client: entry.client,
  venue: entry.venue, address: entry.address, lastSyncedAt: entry.lastSyncedAt, ...uniformStaffing(entry) });
const blankPackout = (id) => ({ nowstaEventId: id, revision: 0, lines: [], notes: '', rosterSizes: [], rosterImport: null });
const staffFields = 'firstName lastName nowstaName nowstaCompanyUserId jacketSize shirtSize pantsSize shoeSize height';
const errorResponse = (res, error) => sendApiError(res, error, { field: 'message', context: 'Uniform packing failed', fallbackMessage: 'Unable to load or save uniform packing' });

// Packers can add zero-stock catalog entries here, but cannot edit inventory counts.
router.post('/catalog-items', async (req, res) => {
  try {
    const { item, created } = await findOrCreatePackingItem(req.body, UniformItem);
    return res.status(created ? 201 : 200).json(item);
  } catch (error) { return errorResponse(res, error); }
});

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
  if (String(entry.nowstaEventId).startsWith('event:')) return entry;
  const direct = await Event.find({ ...query, 'meta.nowsta.apiEventId': entry.nowstaEventId }).select('_id meta.nowsta.uniform catereaseOperations.staffRequest').limit(2).lean();
  if (direct.length) return direct.length === 1 ? direct[0] : null;
  if (!entry.externalId) return null;
  const matches = await Event.find({ ...query, externalId: entry.externalId, date: entry.date }).select('_id meta.nowsta.uniform catereaseOperations.staffRequest').limit(2).lean();
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
    const [packout, staff, catalog, event] = await Promise.all([
      UniformPackout.findOne({ nowstaEventId: entry.nowstaEventId }).lean(), Staff.find({}).select(staffFields).lean(),
      UniformItem.find({ hidden: { $ne: true } }).select('name sizes color category image imageUrl location').sort({ name: 1 }).lean(),
      linkedEvent(entry),
    ]);
    const requirements = eventUniformRequirements(entry, event);
    const sizes = await fillMissingNowstaSizes(buildUniformRoster(entry, staff, packout?.rosterSizes));
    return res.json({ event: { ...summary(entry), linkedEventId: event?._id || null }, requirements,
      sizeLookupWarning: sizes.sizeLookupWarning,
      roster: sizes.roster.map((person) => {
        const assigned = requirements.filter((row) => person.positions.includes(row.position));
        return { ...person, uniform: [...new Set(assigned.map((row) => row.uniform).filter(Boolean))].join(' / '),
          uniformSelfProvided: assigned.length > 0 && assigned.every((row) => row.selfProvided) };
      }),
      packout: packout || blankPackout(entry.nowstaEventId), catalog });
  } catch (error) { return errorResponse(res, error); }
});

router.put('/events/:id/packout', async (req, res) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Event is unavailable or cancelled' });
    const catalog = await UniformItem.find({ hidden: { $ne: true } }).select('name sizes hidden').lean();
    const lines = validateUniformLines(req.body?.lines, catalog);
    const notes = String(req.body?.notes || '').trim().slice(0, 3000);
    const changes = { lines, notes };
    if (req.body?.bags !== undefined) changes.bags = validateUniformBags(req.body.bags, lines, catalog);
    else {
      // An older client must not invalidate bags another packer has already saved.
      const current = await UniformPackout.findOne({ nowstaEventId: entry.nowstaEventId }).select('bags').lean();
      if (current?.bags?.length) validateUniformBags(current.bags, lines, catalog);
    }
    const saved = await saveUniformPackout(entry.nowstaEventId, req.body?.expectedRevision, changes, req.auth.username || req.auth.userId);
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
