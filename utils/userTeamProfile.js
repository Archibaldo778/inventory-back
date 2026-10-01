import mongoose from 'mongoose';
import ReportTeam from '../models/ReportTeam.js';
import { createApiError } from './apiErrors.js';

export const userTeamProfile = async (payload, current = {}) => {
  const changes = {};
  if (payload.jobTitle !== undefined) {
    const title = String(payload.jobTitle || '').trim().toLowerCase();
    if (!['', 'sales', 'team manager', 'assistant', 'executive chef'].includes(title)) throw createApiError(400, 'Choose Sales, Team Manager, Assistant or Executive Chef');
    changes.jobTitle = title;
  }
  if (payload.teamId !== undefined) {
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
  const next = { ...current, ...changes };
  if (next.receivesTeamReports && !next.teamId) throw createApiError(400, 'Select a team to receive its reports');
  return changes;
};
