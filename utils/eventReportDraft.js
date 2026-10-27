import { createApiError } from './apiErrors.js';
export const reportDraftGuard = (report, expectedRevision = 0) => {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (report.draftRevision || 0)) {
    throw createApiError(409, 'This report has newer saved answers. Reload before saving or submitting.');
  }
  return expectedRevision === 0
    ? { $or: [{ draftRevision: 0 }, { draftRevision: { $exists: false } }] }
    : { draftRevision: expectedRevision };
};
