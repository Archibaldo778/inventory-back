import { Router } from 'express';
import mongoose from 'mongoose';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import { createApiError, sendApiError } from '../utils/apiErrors.js';
import { buildTeamDeliveryPlan, loadReportTeamDirectory, normalizeSalesAlias } from '../utils/reportTeams.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { teams, users } = await loadReportTeamDirectory();
    return res.json({ teams: teams.map((team) => ({ ...team, delivery: buildTeamDeliveryPlan(team, users) })), users });
  } catch (error) {
    return sendApiError(res, error, { fallbackMessage: 'Could not load sales teams' });
  }
});

const saveTeam = async (req, res) => {
  try {
    if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) throw createApiError(400, 'Invalid team');
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const salesUserId = String(req.body?.salesUserId || '');
    if (!name || !mongoose.Types.ObjectId.isValid(salesUserId)) throw createApiError(400, 'Team name and Sales account are required');
    const sales = await User.findById(salesUserId).select('_id username email isActive').lean();
    if (!sales) throw createApiError(400, 'Sales account was not found');
    const salesAliases = [...new Set((Array.isArray(req.body?.salesAliases) ? req.body.salesAliases : [])
      .map((alias) => String(alias || '').trim().slice(0, 200)).filter(Boolean))];
    if (salesAliases.length > 20) throw createApiError(400, 'Use up to 20 event name aliases');
    if (typeof req.body?.reportDeliveryEnabled !== 'boolean') throw createApiError(400, 'Choose whether team delivery is enabled');
    const { teams, users } = await loadReportTeamDirectory();
    const aliases = new Set([sales.username, sales.email, ...salesAliases].map(normalizeSalesAlias).filter(Boolean));
    for (const team of teams.filter((entry) => String(entry._id) !== String(req.params.id || ''))) {
      const owner = users.find((user) => String(user._id) === String(team.salesUserId));
      if (String(team.salesUserId) === salesUserId || [owner?.username, owner?.email, ...(team.salesAliases || [])]
        .some((alias) => alias && aliases.has(normalizeSalesAlias(alias)))) {
        throw createApiError(409, `Sales or event name is already assigned to ${team.name}`);
      }
    }
    const payload = { name, salesUserId, salesAliases, reportDeliveryEnabled: req.body.reportDeliveryEnabled };
    const preview = buildTeamDeliveryPlan({ _id: req.params.id || '', ...payload }, users);
    if (payload.reportDeliveryEnabled && preview.issues.length) throw createApiError(400, preview.issues.join('; '));
    const team = req.params.id
      ? await ReportTeam.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true })
      : await ReportTeam.create(payload);
    if (!team) throw createApiError(404, 'Team was not found');
    return res.status(req.params.id ? 200 : 201).json({ team });
  } catch (error) {
    return sendApiError(res, error, { fallbackMessage: 'Could not save the sales team' });
  }
};

router.post('/', saveTeam);
router.put('/:id', saveTeam);

export default router;
