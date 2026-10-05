import mongoose from 'mongoose';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import { createApiError } from './apiErrors.js';

export const userTeamProfile = async (payload, current = {}) => {
  const changes = {};
  if (payload.jobTitle !== undefined) {
    const title = String(payload.jobTitle || '').trim().toLowerCase();
    if (!['', 'sales', 'team manager', 'assistant', 'executive chef'].includes(title)) throw createApiError(400, 'Choose Sales, Team Manager, Assistant or Executive Chef');
    changes.jobTitle = title;
  }
  if (payload.teamId !== undefined && payload.worksWithUserId === undefined) {
    const teamId = String(payload.teamId || '').trim();
    if (teamId && (!mongoose.Types.ObjectId.isValid(teamId) || !await ReportTeam.exists({ _id: teamId }))) {
      throw createApiError(400, 'Choose an existing team');
    }
    changes.teamId = teamId || null;
  }
  if (payload.receivesTeamReports !== undefined) {
    if (typeof payload.receivesTeamReports !== 'boolean') throw createApiError(400, 'Report recipient must be on or off');
    changes.receivesTeamReports = payload.receivesTeamReports;
  }
  if (payload.worksWithUserId !== undefined) {
    const salesUserId = String(payload.worksWithUserId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(salesUserId)) throw createApiError(400, 'Choose the Sales person this employee works with');
    if (salesUserId === String(current._id || '')) throw createApiError(400, 'Choose another person as Sales');
    const sales = await User.findById(salesUserId).select('_id username role jobTitle isActive').lean();
    if (!sales || sales.isActive === false) throw createApiError(400, 'Choose an active Sales account');
    let team = await ReportTeam.findOne({ salesUserId }).lean();
    if (!team && sales.role !== 'sales rep' && sales.jobTitle !== 'sales') throw createApiError(400, 'Choose a Sales account');
    if (!team) {
      // Keep existing delivery rules; assigning a colleague must not start a new mailing.
      try {
        team = await ReportTeam.findOneAndUpdate({ salesUserId }, { $setOnInsert: {
          name: sales.username, salesUserId, salesAliases: [], reportDeliveryEnabled: false,
        } }, { upsert: true, new: true, runValidators: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
        team = await ReportTeam.findOne({ salesUserId }).lean();
        if (!team) throw error;
      }
    }
    changes.teamId = team._id;
  }
  const next = { ...current, ...changes };
  if (next.receivesTeamReports && !next.teamId) throw createApiError(400, 'Select a team to receive its reports');
  return changes;
};
