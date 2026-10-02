import { Router } from 'express';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { isValidInviteEmail } from '../utils/userInvitations.js';
import { PASSWORD_RESET_MESSAGE, PASSWORD_RESET_INVALID, hashPasswordResetToken, validPasswordResetToken,
  passwordResetValidation, requestPasswordReset, completePasswordReset } from '../utils/passwordReset.js';

const router = Router();
const emailFrom = (req) => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
const ipKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
export const resetRequestIpLimit = createMemoryRateLimiter({ windowMs: 15 * 60_000, max: 20, keyGenerator: ipKey });
export const resetRequestEmailLimit = createMemoryRateLimiter({ windowMs: 60 * 60_000, max: 3,
  keyGenerator: (req) => hashPasswordResetToken(emailFrom(req)) });
export const resetSubmitLimit = createMemoryRateLimiter({ windowMs: 15 * 60_000, max: 20, keyGenerator: ipKey });

// Public recovery endpoints: possession of a short-lived random token authorizes a password change.
router.post('/forgot-password', resetRequestIpLimit, resetRequestEmailLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const email = emailFrom(req);
  if (email.length > 320 || !isValidInviteEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ message: 'Password recovery is temporarily unavailable. Please try again later.' });
  // Respond before account lookup/email delivery, so neither content nor timing discloses an account.
  res.status(202).json({ message: PASSWORD_RESET_MESSAGE });
  try { await requestPasswordReset(email); }
  catch { console.error('Password recovery request could not be completed'); }
});

router.post('/reset-password', resetSubmitLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { token, password } = req.body || {};
  if (!validPasswordResetToken(token)) return res.status(400).json({ message: PASSWORD_RESET_INVALID });
  const validation = passwordResetValidation(password);
  if (validation) return res.status(400).json({ message: validation });
  try {
    if (!await completePasswordReset(token, password)) return res.status(400).json({ message: PASSWORD_RESET_INVALID });
    res.clearCookie('rt', { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production', path: '/api/auth' });
    return res.json({ ok: true, message: 'Your password has been changed. Sign in with your new password.' });
  } catch {
    console.error('Password reset could not be completed');
    return res.status(503).json({ message: 'Password recovery is temporarily unavailable. Please try again later.' });
  }
});

export default router;
