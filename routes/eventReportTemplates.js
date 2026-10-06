import { Router } from 'express';
import EventReportTemplate from '../models/EventReportTemplate.js';
import { defaultReportTemplate, loadReportTemplate, validateReportTemplate } from '../utils/captainReportTemplate.js';
import { effectiveAccessRole } from '../utils/salesAccess.js';
import { permissionValue } from '../utils/accessRolePolicy.js';
import { createApiError, sendApiError } from '../utils/apiErrors.js';

const router = Router();
export const canEditReportTemplate = (auth, type) => permissionValue(auth, `${type}Template.edit`, ['admin', 'super admin', type === 'kitchen' ? 'kitchen admin' : 'staffing admin'].includes(effectiveAccessRole(auth)));
export const canEditCaptainTemplate = (auth) => canEditReportTemplate(auth, 'captain');
for (const type of ['captain', 'kitchen']) {
router.get(`/${type}`, async (req, res) => {
  try { return res.json({ template: await loadReportTemplate(type), defaults: defaultReportTemplate(type), canEdit: canEditReportTemplate(req.auth, type) }); }
  catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load the report template' }); }
});
router.put(`/${type}`, async (req, res) => {
  if (!canEditReportTemplate(req.auth, type)) return res.status(403).json({ message: 'Template editing requires an administrator for this department' });
  try {
    const payload = validateReportTemplate(req.body, type);
    const expectedRevision = req.body.expectedRevision;
    const template = await EventReportTemplate.findOneAndUpdate({ _id: type, revision: expectedRevision }, {
      $set: { ...payload, updatedBy: String(req.auth?.username || req.auth?.sub || '').slice(0, 200) }, $inc: { revision: 1 },
    }, { upsert: expectedRevision === 0, new: true, runValidators: true });
    if (!template) throw createApiError(409, 'Template changed. Reload before saving.');
    return res.json({ template });
  } catch (error) {
    return sendApiError(res, error.code === 11000 ? createApiError(409, 'Template changed. Reload before saving.') : error,
      { fallbackMessage: 'Could not save the report template' });
  }
});
}
export default router;
