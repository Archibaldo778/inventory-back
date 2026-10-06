import { Router } from 'express';
import crypto from 'node:crypto';
import AccessRole from '../models/AccessRole.js';
import { isRoleOwner } from '../utils/roleOwners.js';
import { ACCESS_SECTIONS, ACCESS_SPECIALS, BUILTIN_ROLES, validateRoleChanges, roleDefaults } from '../utils/accessRoleCatalog.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
export const requireRoleOwner = (req, res, next) => isRoleOwner(req.auth)
  ? next() : res.status(403).json({ message: 'Role management is restricted to the account owners' });
router.use(requireRoleOwner);

router.get('/', async (_req, res) => {
  try {
    const saved = await AccessRole.find({}).select('-audit').lean();
    const roles = new Map(BUILTIN_ROLES.map((role) => [role._id, role]));
    for (const role of saved) roles.set(role._id, { ...roles.get(role._id), ...role });
    return res.json({ roles: [...roles.values()].map((role) => ({ ...role, defaults: roleDefaults(role) })), sections: ACCESS_SECTIONS, specialActions: ACCESS_SPECIALS });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load roles' }); }
});

router.post('/', async (req, res) => {
  try {
    const changes = validateRoleChanges(req.body);
    const source = await AccessRole.findById(String(req.body.copyFrom || '')).lean()
      || BUILTIN_ROLES.find((role) => role._id === req.body.copyFrom);
    if (!source) return res.status(400).json({ message: 'Choose a role to copy' });
    if (['sales', 'assistant', 'team manager'].includes(source._id) && changes.permissions['bar.financials'] === undefined) changes.permissions['bar.financials'] = true;
    const role = await AccessRole.create({ _id: `custom-${crypto.randomUUID()}`, ...changes, baseRole: source.baseRole, jobTitle: source.jobTitle || '',
      revision: 1, audit: [{ actorId: req.auth.userId, at: new Date(), before: null, after: changes }] });
    return res.status(201).json({ role });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not create role' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const changes = validateRoleChanges(req.body);
    const revision = req.body.expectedRevision;
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ message: 'Reload the role before saving' });
    const saved = await AccessRole.findById(req.params.id).lean();
    const current = saved || BUILTIN_ROLES.find((role) => role._id === req.params.id);
    if (!current) return res.status(404).json({ message: 'Role not found' });
    if (current.revision !== revision) return res.status(409).json({ message: 'Role changed. Reload before saving.' });
    const role = await AccessRole.findOneAndUpdate({ _id: req.params.id, revision }, {
      $set: changes, $setOnInsert: { baseRole: current.baseRole, jobTitle: current.jobTitle || '' }, $inc: { revision: 1 },
      $push: { audit: { actorId: req.auth.userId, at: new Date(),
        before: { name: current.name, permissions: current.permissions }, after: changes } },
    }, { new: true, upsert: !saved, runValidators: true });
    if (!role) return res.status(409).json({ message: 'Role changed. Reload before saving.' });
    return res.json({ role });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Role changed. Reload before saving.' });
    return sendApiError(res, error, { fallbackMessage: 'Could not save role' });
  }
});

router.get('/:id/audit', async (req, res) => {
  try {
    const role = await AccessRole.findById(req.params.id).select('audit').lean();
    return res.json({ audit: role?.audit || [] });
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load role history' }); }
});
export default router;
