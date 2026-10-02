import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';
import { userInviteUrl } from './userInvitations.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

export const PASSWORD_RESET_MESSAGE = 'If an active account uses this email, you will receive a password reset link. Check your inbox and spam folder.';
export const PASSWORD_RESET_INVALID = 'This reset link is invalid or has expired. Request a new link.';
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
export const hashPasswordResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const validPasswordResetToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
export const passwordResetValidation = (password) => {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long. Use no more than 72 bytes (fewer characters with emoji).';
  return '';
};

export const passwordResetUrl = (token) => {
  const url = new URL('/reset-password', userInviteUrl(''));
  // Fragments are not sent to web servers or included in Referer headers.
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
};

export const sendPasswordResetEmail = async ({ email, token, fetchImpl = globalThis.fetch }) => {
  const link = passwordResetUrl(token);
  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `password-reset:${hashPasswordResetToken(token)}` },
    body: JSON.stringify({
      from: process.env.PASSWORD_RESET_FROM || 'OCC Decks <reports@reports.occdecks.com>',
      to: [email], subject: 'OCC Decks — reset your password',
      text: `Reset your OCC Decks password:\n\n${link}\n\nThis private link expires in 30 minutes and can be used once. If you did not request this, ignore this email. Your password has not changed.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;color:#222"><h2>Reset your OCC Decks password</h2><p>Use the button below to choose a new password.</p><p><a href="${link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display:inline-block;padding:12px 20px;background:#202b32;color:#fff;border-radius:8px;text-decoration:none">Reset password</a></p><p>This private link expires in <strong>30 minutes</strong> and can be used once.</p><p>If you did not request this, ignore this email. Your password has not changed.</p></div>`,
    }),
  }, { timeoutMs: 15_000, fetchImpl });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error('Password reset email was not confirmed');
};

export const requestPasswordReset = async (email, { now = new Date(), Users = User, sendEmail = sendPasswordResetEmail } = {}) => {
  const user = await Users.findOne({ email, isActive: { $ne: false } }).select('_id email +tokenVersion');
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);
  const version = Number(user.tokenVersion || 0);
  // Persist the cooldown and claim before mailing, including across server instances.
  const claimed = await Users.findOneAndUpdate({ _id: user._id, email, isActive: { $ne: false },
    $expr: { $eq: [{ $ifNull: ['$tokenVersion', 0] }, version] },
    $or: [{ passwordResetRequestedAt: null }, { passwordResetRequestedAt: { $lte: new Date(+now - 60_000) } }],
  }, { $set: { passwordResetHash: tokenHash, passwordResetExpiresAt: new Date(+now + PASSWORD_RESET_TTL_MS),
    passwordResetRequestedAt: now, passwordResetVersion: version, passwordResetEmail: email } }, { new: true }).select('_id');
  if (!claimed) return;
  // Leave an uncertain delivery usable: a provider timeout may follow successful acceptance.
  await sendEmail({ email, token });
};

export const completePasswordReset = async (token, password, { now = new Date(), Users = User } = {}) => {
  if (!validPasswordResetToken(token) || passwordResetValidation(password)) return false;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await Users.findOneAndUpdate({
    passwordResetHash: hashPasswordResetToken(token), passwordResetExpiresAt: { $gt: now }, isActive: { $ne: false },
    $expr: { $and: [
      { $eq: [{ $ifNull: ['$tokenVersion', 0] }, '$passwordResetVersion'] },
      { $eq: ['$email', '$passwordResetEmail'] },
    ] },
  }, { $set: { password: passwordHash, passwordResetHash: '', passwordResetExpiresAt: null,
    passwordResetVersion: null, passwordResetEmail: '', inviteTokenHash: '', inviteExpiresAt: null },
    $inc: { tokenVersion: 1 },
  }, { new: true }).select('_id');
  return Boolean(user);
};
