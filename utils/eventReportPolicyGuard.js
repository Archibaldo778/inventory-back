import Event from '../models/Event.js';
import { createApiError } from './apiErrors.js';

const protectedKeys = ['captainReportDisabled', 'captainReportPolicyAudit'];
export const withoutCaptainReportPolicy = (meta) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return Object.fromEntries(Object.entries(meta).filter(([key]) => !protectedKeys.includes(key)));
};

// Generic event editing must not bypass the dedicated, authorized and audited policy endpoint.
export const updateEventPreservingReportPolicy = async (id, updates) => {
  const current = await Event.findById(id).select('meta.captainReportDisabled meta.captainReportPolicyAudit').lean();
  if (!current) return null;
  const filter = { _id: id };
  const meta = withoutCaptainReportPolicy(updates.meta);
  for (const key of protectedKeys) {
    if (Object.hasOwn(current.meta || {}, key)) {
      meta[key] = current.meta[key]; filter[`meta.${key}`] = current.meta[key];
    } else filter[`meta.${key}`] = { $exists: false };
  }
  const updated = await Event.findOneAndUpdate(filter, { ...updates, meta }, { new: true, runValidators: true });
  if (!updated) throw createApiError(409, 'The event report setting changed. Refresh the event before saving.');
  return updated;
};
