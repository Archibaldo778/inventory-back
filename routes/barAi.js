import { Router } from 'express';
import BarAiSettings from '../models/BarAiSettings.js';
import BarEvent from '../models/BarEvent.js';
import { isRoleOwner } from '../utils/roleOwners.js';
import { BAR_AI_RULES } from '../utils/barDocumentAi.js';
const router = Router();
export const requireBarAiOwner = (req, res, next) => isRoleOwner(req.auth) ? next() : res.status(403).json({ message: 'Only the account owners can teach document AI' });
router.use(requireBarAiOwner);
router.get('/', async (_req, res, next) => {
  try {
    const settings = await BarAiSettings.findById('bar').lean();
    const review = await BarEvent.find({ 'importReview.status': 'needs_review' }).select('_id name eventDate importReview').sort({ eventDate: -1 }).limit(100).lean();
    res.json({ rules: settings?.rules || '', revision: settings?.revision || 0, audit: settings?.audit || [], baseRules: BAR_AI_RULES, review });
  } catch (error) { next(error); }
});
export async function saveBarAiSettings(req, res, next) {
  try {
    const { rules, expectedRevision } = req.body || {};
    if (typeof rules !== 'string' || rules.length > 16000 || !Number.isInteger(expectedRevision) || expectedRevision < 0) return res.status(400).json({ message: 'Provide rules (up to 16,000 characters) and the current revision' });
    const audit = { at: new Date(), userId: String(req.auth.userId || req.auth._id || ''), username: String(req.auth.username || ''), rules };
    const result = await BarAiSettings.findOneAndUpdate({ _id: 'bar', revision: expectedRevision }, {
      $set: { rules }, $inc: { revision: 1 }, $push: { audit: { $each: [audit], $slice: -100 } },
    }, { new: true, upsert: expectedRevision === 0, setDefaultsOnInsert: false });
    if (!result) return res.status(409).json({ message: 'Rules changed. Reload before saving.' });
    return res.json({ rules: result.rules, revision: result.revision, audit: result.audit });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Rules changed. Reload before saving.' });
    return next(error);
  }
}
router.put('/', saveBarAiSettings);
export default router;
