import { Router } from 'express';
import AccessRequest from '../models/AccessRequest.js';
import { requireRoles } from '../middleware/auth.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { isValidInviteEmail } from '../utils/userInvitations.js';
import { sendApiError } from '../utils/apiErrors.js';
import { ACCESS_REQUEST_MESSAGE, requestRegistration, approveRegistration, activateRegistration, reviewableRequests } from '../utils/accessRequests.js';
import { readRegistrationStatus } from '../utils/registrationStatus.js';

const emailFrom = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = (email) => email.length <= 320 && isValidInviteEmail(email);
export const accessRequestLimit = createMemoryRateLimiter({ windowMs: 60 * 60_000, max: 10,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown' });
export const activationLimit = createMemoryRateLimiter({ windowMs: 15 * 60_000, max: 20,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown' });
export const publicAccessRequestRoutes = Router();
export const registrationStatusLimit = createMemoryRateLimiter({ windowMs: 60_000, max: 120,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown' });

publicAccessRequestRoutes.post('/request-access', accessRequestLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const session = await requestRegistration(req.body);
    return res.status(202).json({ message: ACCESS_REQUEST_MESSAGE, ...(session ? { session } : {}) });
  } catch (error) { return sendApiError(res, error, { context: 'Registration request failed', fallbackMessage: 'Could not submit your request. Please try again.' }); }
});
publicAccessRequestRoutes.post('/registration-status', registrationStatusLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await readRegistrationStatus(req.body?.token);
    if (!status) return res.status(410).json({ message: 'Your registration session has expired. Submit the form with your original email and password to view your request again.' });
    return res.json(status);
  } catch (error) { return sendApiError(res, error, { context: 'Registration status failed', fallbackMessage: 'Could not check your registration status. Please try again.' }); }
});
publicAccessRequestRoutes.post('/activate-account', activationLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const email = await activateRegistration(req.body?.token, req.body?.password);
    if (!email) return res.status(400).json({ message: 'Check your password and activation link. If the link has expired or you already activated your account, contact your administrator or sign in.' });
    return res.json({ ok: true, email });
  } catch (error) { return sendApiError(res, error, { context: 'Account activation failed', fallbackMessage: 'Could not activate your account. Please try again.' }); }
});

const router = Router();
router.use(requireRoles(['admin', 'super admin', 'staffing admin']));
router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const email = emailFrom(req.query?.email);
    if (email && !validEmail(email)) return res.status(400).json({ message: 'Choose a valid request.' });
    const rows = await AccessRequest.find({ ...reviewableRequests(req.auth), ...(email ? { _id: email } : {}) }).sort({ requestedAt: 1 }).limit(200).lean();
    return res.json({ items: rows.map((row) => ({ email: row._id, name: row.name, requestedAt: row.requestedAt,
      status: row.status, department: row.department || 'other', role: row.role, emailSentAt: row.emailSentAt })) });
  } catch (error) { return sendApiError(res, error, { context: 'Registration request list failed', fallbackMessage: 'Could not load registration requests' }); }
});
router.post('/:email/approve', async (req, res) => {
  const email = emailFrom(req.params.email);
  if (!validEmail(email)) return res.status(400).json({ message: 'Choose a valid request.' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ message: 'Activation email is not configured.' });
  try {
    await approveRegistration({ email, role: req.body?.role, auth: req.auth });
    return res.json({ ok: true });
  } catch (error) { return sendApiError(res, error, { context: 'Registration approval failed', fallbackMessage: 'Could not approve registration. Please refresh and try again.' }); }
});
router.post('/:email/reject', async (req, res) => {
  const email = emailFrom(req.params.email);
  if (!validEmail(email)) return res.status(400).json({ message: 'Choose a valid request.' });
  try {
    const result = await AccessRequest.updateOne({ _id: email, ...reviewableRequests(req.auth) },
      { $set: { status: 'rejected', reviewedBy: String(req.auth.userId || ''), activationHash: '', activationExpiresAt: null }, $unset: { passwordHash: 1 } });
    if (!result.matchedCount) return res.status(409).json({ message: 'This request was already processed. Refresh the list.' });
    return res.json({ ok: true });
  } catch (error) { return sendApiError(res, error, { context: 'Registration rejection failed', fallbackMessage: 'Could not reject registration' }); }
});
export default router;
