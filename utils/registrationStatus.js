import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import AccessRequest from '../models/AccessRequest.js';
import { hashPasswordResetToken, validPasswordResetToken } from './passwordReset.js';

// This credential only reads the applicant's status. It is never a login JWT.
export const issueRegistrationSession = async ({ email, password }, { Requests = AccessRequest, now = new Date() } = {}) => {
  const request = await Requests.findOne({ _id: email, status: { $in: ['pending', 'approved'] } }).select('+passwordHash');
  if (!request?.passwordHash || !await bcrypt.compare(password, request.passwordHash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(+now + 30 * 86400_000);
  const result = await Requests.updateOne({ _id: email, passwordHash: request.passwordHash, status: { $in: ['pending', 'approved'] } },
    { $set: { statusTokenHash: hashPasswordResetToken(token), statusExpiresAt: expiresAt } });
  return result.matchedCount ? { token, expiresAt: expiresAt.toISOString() } : null;
};

export const readRegistrationStatus = async (token, { Requests = AccessRequest, now = new Date() } = {}) => {
  if (!validPasswordResetToken(token)) return null;
  const request = await Requests.findOne({ statusTokenHash: hashPasswordResetToken(token), statusExpiresAt: { $gt: now } })
    .select('_id name status emailSentAt').lean();
  if (!request) return null;
  return { name: request.name, email: request._id,
    status: request.status === 'activating' ? 'approved' : request.status,
    emailSent: Boolean(request.emailSentAt) };
};
