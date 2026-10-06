import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import AccessRequest from '../models/AccessRequest.js';
import User from '../models/Users.js';
import { passwordResetValidation, hashPasswordResetToken, validPasswordResetToken } from './passwordReset.js';
import { userInviteUrl, isValidInviteEmail } from './userInvitations.js';
import { invitationRolesFor } from './departmentAccess.js';
import { resolveUserInvitationSender } from './userInvitationSender.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { createApiError } from './apiErrors.js';
import { registrationReviewEmail, deliverRegistrationNotification } from './registrationNotifications.js';

export const ACCESS_REQUEST_MESSAGE = 'Your registration request has been received. If you already have an account or invitation, use Login or the link in your invitation email.';
export const registrationDetails = (body = {}) => {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const department = body.department || 'other';
  if (!['captain', 'kitchen', 'other'].includes(department)) throw createApiError(400, 'Choose Captain, Kitchen or Other.');
  if (!name || name.length > 240 || email.length > 320 || !isValidInviteEmail(email)) throw createApiError(400, 'Enter your full name and a valid email address.');
  const error = passwordResetValidation(body.password);
  if (error) throw createApiError(400, error);
  return { name, email, department, password: body.password };
};

export const requestRegistration = async (body, { Requests = AccessRequest, Users = User,
  notify = (email) => deliverRegistrationNotification({ email, Requests }),
} = {}) => {
  const { name, email, department, password } = registrationDetails(body);
  const passwordHash = await bcrypt.hash(password, 10);
  if (await Users.exists({ email })) return;
  // One pending request per email. A duplicate never replaces the chosen password.
  try {
    const created = await Requests.updateOne({ _id: email }, { $setOnInsert: { name, department, passwordHash, status: 'pending', requestedAt: new Date(),
      notificationStatus: 'queued', notificationPayload: registrationReviewEmail({ name, email, department }),
    } }, { upsert: true });
    if (created.upsertedCount) {
      try { await notify(email); }
      catch { console.error('Registration review notification deferred for retry'); }
    }
  } catch (error) { if (error.code !== 11000) throw error; }
};

export const sendActivationEmail = async ({ email, token, sender, fetchImpl = globalThis.fetch }) => {
  const identity = resolveUserInvitationSender(sender);
  const url = new URL('/activate-account', userInviteUrl(''));
  url.hash = new URLSearchParams({ token }).toString();
  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `registration:${hashPasswordResetToken(token)}` },
    body: JSON.stringify({ from: identity.from, reply_to: identity.email, to: [email], subject: 'OCC Decks — your registration is approved',
      text: `Your OCC Decks registration has been approved. Confirm your email to activate your account:\n\n${url.href}\n\nThen sign in with the password you chose when registering. This link expires in 30 days. If you did not request an account, ignore this email.` }),
  }, { timeoutMs: 15_000, fetchImpl });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw createApiError(502, 'Approval saved, but email delivery was not confirmed. You can retry sending the activation email.');
};

export const approveRegistration = async ({ email, role, auth }, { Requests = AccessRequest, Users = User, sendEmail = sendActivationEmail, now = new Date() } = {}) => {
  if (!invitationRolesFor(auth).includes(role)) throw createApiError(403, 'You cannot approve this account role.');
  if (await Users.exists({ email })) throw createApiError(409, 'This email already has an account. Manage it in User Administration.');
  const token = crypto.randomBytes(32).toString('hex');
  const activationHash = hashPasswordResetToken(token);
  const claimed = await Requests.findOneAndUpdate({ _id: email, passwordHash: { $type: 'string', $ne: '' },
    $and: [reviewableRequests(auth), { $or: [{ emailAttemptAt: null }, { emailAttemptAt: { $lte: new Date(+now - 60_000) } }] }],
  }, { $set: { status: 'approved', role, reviewedBy: String(auth.userId || ''), activationHash,
    activationExpiresAt: new Date(+now + 30 * 86400_000), emailAttemptAt: now, emailSentAt: null } }, { new: true }).select('_id');
  if (!claimed) throw createApiError(409, 'This request is no longer pending or was just processed. Refresh or wait a minute before retrying.');
  // Keep uncertain deliveries usable, and require an explicit administrator retry.
  await sendEmail({ email, token, sender: auth });
  await Requests.updateOne({ _id: email, status: 'approved', activationHash }, { $set: { emailSentAt: now } });
};

export const reviewableRequests = (auth) => ({ $or: [{ status: 'pending' }, { status: 'approved', role: { $in: invitationRolesFor(auth) } }] });

export const activateRegistration = async (token, password, { Requests = AccessRequest, Users = User, now = new Date() } = {}) => {
  if (!validPasswordResetToken(token) || passwordResetValidation(password)) return false;
  const activationHash = hashPasswordResetToken(token);
  const request = await Requests.findOneAndUpdate({ status: 'approved', activationHash, activationExpiresAt: { $gt: now } },
    { $set: { status: 'activating' } }, { new: true }).select('+passwordHash');
  if (!request) return false;
  // Email confirmation must also prove knowledge of the chosen password. This
  // prevents activating a request someone else submitted using this address.
  if (!await bcrypt.compare(password, request.passwordHash)) {
    await Requests.updateOne({ _id: request._id, status: 'activating', activationHash }, { $set: { status: 'approved' } });
    return false;
  }
  try {
    await Users.create({ username: request.name, email: request._id, nowstaName: request.name, role: request.role,
      password: request.passwordHash, isActive: true, inviteAcceptedAt: now });
  } catch (error) {
    await Requests.updateOne({ _id: request._id, status: 'activating', activationHash }, { $set: { status: error.code === 11000 ? 'rejected' : 'approved' } });
    if (error.code === 11000) return false;
    throw error;
  }
  await Requests.updateOne({ _id: request._id, status: 'activating', activationHash }, { $set: { status: 'completed', activationHash: '', activationExpiresAt: null }, $unset: { passwordHash: 1 } });
  return request._id;
};
