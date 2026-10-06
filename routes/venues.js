import { Router } from 'express';
import mongoose from 'mongoose';
import Venue from '../models/Venue.js';
import VenueNote from '../models/VenueNote.js';
import { createApiError, sendApiError } from '../utils/apiErrors.js';
import { effectiveAccessRole } from '../utils/salesAccess.js';
import { venueIdentity, expectedVenueRevision, venueNoteMetadata, venueNotesFingerprint } from '../utils/venues.js';
import { buildVenueSummary } from '../utils/venueKnowledge.js';

const router = Router();
const canEdit = (auth) => ['admin', 'super admin'].includes(effectiveAccessRole(auth));
export const requireVenueEditor = (req, res, next) => canEdit(req.auth) ? next() : res.status(403).json({ message: 'Venue editing requires administrator access' });
const validId = (id) => { if (!mongoose.Types.ObjectId.isValid(id)) throw createApiError(400, 'Invalid venue or note'); };
const actor = (req) => String(req.auth?.username || req.auth?.sub || 'Administrator').slice(0, 200);
const fail = (res, error) => sendApiError(res, error.code === 11000 ? createApiError(409, 'This venue name or alias already exists at this address') : error,
  { fallbackMessage: 'Could not update the venue directory' });

router.get('/', async (req, res) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = search ? { $or: ['name', 'address', 'aliases'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) } : {};
    const page = Math.max(0, Math.min(10000, Number.parseInt(req.query.page, 10) || 0));
    const [items, total] = await Promise.all([
      Venue.find(filter).select('-summary').sort({ name: 1, _id: 1 }).skip(page * 50).limit(50).lean(), Venue.countDocuments(filter),
    ]);
    return res.json({ items, total, page, canEdit: canEdit(req.auth) });
  } catch (error) { return fail(res, error); }
});

router.post('/', requireVenueEditor, async (req, res) => {
  try { return res.status(201).json({ venue: await Venue.create(venueIdentity(req.body)) }); }
  catch (error) { return fail(res, error); }
});

router.get('/:id', async (req, res) => {
  try {
    validId(req.params.id);
    const [venue, notes] = await Promise.all([Venue.findById(req.params.id).lean(), VenueNote.find({ venueId: req.params.id }).sort({ observedAt: -1, _id: -1 }).lean()]);
    if (!venue) throw createApiError(404, 'Venue was not found');
    return res.json({ venue, notes, canEdit: canEdit(req.auth), summaryStale: Boolean(venue.summary && venue.summary.fingerprint !== venueNotesFingerprint(notes)) });
  } catch (error) { return fail(res, error); }
});

router.patch('/:id', requireVenueEditor, async (req, res) => {
  try {
    validId(req.params.id);
    const revision = expectedVenueRevision(req.body?.expectedRevision);
    const payload = venueIdentity(req.body);
    const venue = await Venue.findOneAndUpdate({ _id: req.params.id, revision }, { $set: payload, $inc: { revision: 1 } }, { new: true, runValidators: true });
    if (!venue) throw createApiError(409, 'Venue changed. Reload before saving.');
    return res.json({ venue });
  } catch (error) { return fail(res, error); }
});

router.post('/:id/notes', requireVenueEditor, async (req, res) => {
  try {
    validId(req.params.id);
    if (!await Venue.exists({ _id: req.params.id })) throw createApiError(404, 'Venue was not found');
    const text = String(req.body?.text || '').trim();
    const source = req.body?.source;
    if (!text || text.length > 12000 || !['manual', 'caterease'].includes(source)) throw createApiError(400, 'Enter a note (up to 12,000 characters) and its source');
    const sourceLabel = String(req.body?.sourceLabel || actor(req)).trim().slice(0, 300);
    const now = new Date(); const _id = new mongoose.Types.ObjectId();
    const note = await VenueNote.create({ _id, venueId: req.params.id, sourceKey: `manual:${_id}`, source, sourceLabel, text,
      sourceDate: now.toISOString().slice(0, 10), observedAt: now, ...venueNoteMetadata(req.body),
      history: [{ at: now, actor: actor(req), action: 'created' }] });
    return res.status(201).json({ note });
  } catch (error) { return fail(res, error); }
});

router.patch('/:id/notes/:noteId', requireVenueEditor, async (req, res) => {
  try {
    validId(req.params.id); validId(req.params.noteId);
    const revision = expectedVenueRevision(req.body?.expectedRevision);
    const metadata = venueNoteMetadata(req.body);
    const note = await VenueNote.findOneAndUpdate({ _id: req.params.noteId, venueId: req.params.id, revision }, {
      $set: metadata, $inc: { revision: 1 }, $push: { history: { at: new Date(), actor: actor(req), action: 'updated', ...metadata } },
    }, { new: true, runValidators: true });
    if (!note) throw createApiError(409, 'Note changed. Reload before saving.');
    return res.json({ note });
  } catch (error) { return fail(res, error); }
});

router.post('/:id/summary', requireVenueEditor, async (req, res) => {
  try {
    validId(req.params.id);
    const venue = await Venue.findById(req.params.id).lean();
    if (!venue) throw createApiError(404, 'Venue was not found');
    const notes = await VenueNote.find({ venueId: venue._id }).lean();
    const summary = await buildVenueSummary({ venue, notes });
    const latest = await VenueNote.find({ venueId: venue._id }).lean();
    if (summary.fingerprint !== venueNotesFingerprint(latest)) throw createApiError(409, 'Notes changed during analysis. Generate the summary again.');
    const saved = await Venue.updateOne({ _id: venue._id, revision: venue.revision }, { $set: { summary } });
    if (!saved.matchedCount) throw createApiError(409, 'Venue changed during analysis. Reload and try again.');
    return res.json({ summary });
  } catch (error) { return fail(res, error); }
});

export default router;
