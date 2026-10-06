import crypto from 'node:crypto';
import AccessRequest from '../models/AccessRequest.js';
import { resolveAutomaticEmailSender } from './userInvitationSender.js';
import { userInviteUrl } from './userInvitations.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const registrationReviewEmail = ({ name, email, department = 'other' }) => {
  const identity = resolveAutomaticEmailSender();
  const mailbox = (value) => {
    const address = String(value).trim().toLowerCase();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address)) throw new Error('One email address per review recipient is required');
    return address;
  };
  const to = [...new Set([mailbox(process.env.REGISTRATION_REVIEW_EMAIL || process.env.USER_INVITE_REPLY_TO || 'ivan@ocnyc.com'), mailbox(process.env.REGISTRATION_REVIEW_SECOND_EMAIL || 'iurie@ocnyc.com')])];
  const copy = department === 'captain' ? process.env.REGISTRATION_REVIEW_STAFFING_EMAIL || 'staffing@ocnyc.com'
    : department === 'kitchen' ? process.env.REGISTRATION_REVIEW_KITCHEN_EMAIL || 'jerome@ocnyc.com' : '';
  const cc = copy ? [mailbox(copy)].filter((address) => !to.includes(address)) : [];
  const label = { captain: 'Captain', kitchen: 'Kitchen', other: 'Other' }[department] || 'Other';
  const url = new URL('/admin-users', userInviteUrl(''));
  url.hash = new URLSearchParams({ registration: email }).toString();
  return {
    from: identity.from, to, ...(cc.length ? { cc } : {}),
    subject: 'OCC Decks — new registration request',
    text: `New registration request\n\nName: ${name}\nEmail: ${email}\nDepartment: ${label}\n\nReview and approve or reject this request:\n${url.href}\n\nThe account has no access until you approve it and the person confirms their email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>New registration request</h2><p><strong>${escapeHtml(name)}</strong><br>${escapeHtml(email)}<br>${label}</p><p><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:12px 20px;background:#202b32;color:#fff;border-radius:8px;text-decoration:none">Review registration</a></p><p>Choose the position, then approve or reject. The account has no access until approved and the email is confirmed.</p></div>`,
  };
};

export const deliverRegistrationNotification = async ({ email, Requests = AccessRequest, fetchImpl = globalThis.fetch, apiKey = process.env.RESEND_API_KEY, now = new Date() } = {}) => {
  if (!apiKey) return 'unconfigured';
  const scope = { status: 'pending', ...(email ? { _id: email } : {}) };
  const lock = new Date(+now + 2 * 60_000);
  let job = await Requests.findOneAndUpdate({ ...scope, notificationStatus: 'queued' }, {
    $set: { notificationStatus: 'processing', notificationFirstAttemptAt: now, notificationLockedUntil: lock },
  }, { new: true }).select('+notificationPayload');
  if (!job) job = await Requests.findOneAndUpdate({ ...scope, notificationStatus: { $in: ['processing', 'failed'] },
    notificationFirstAttemptAt: { $gt: new Date(+now - 23 * 60 * 60_000) }, notificationLockedUntil: { $lte: now },
  }, { $set: { notificationStatus: 'processing', notificationLockedUntil: lock } }, { new: true }).select('+notificationPayload');
  if (!job) return 'idle';
  const claim = { _id: job._id, notificationStatus: 'processing', notificationLockedUntil: lock };
  try {
    // Older queued payloads may contain a personal display name. Keep their
    // original mailbox, recipients and idempotency key when correcting it.
    const payload = { ...job.notificationPayload, from: resolveAutomaticEmailSender(job.notificationPayload?.from).from };
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `registration-review:${crypto.createHash('sha256').update(job._id).digest('hex')}` },
      // Persisted when queued: retries use the exact same body and recipient.
      body: JSON.stringify(payload),
    }, { timeoutMs: 15_000, fetchImpl });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error('Review notification delivery was not confirmed');
    await Requests.updateOne(claim, { $set: { notificationStatus: 'sent', notificationSentAt: now, notificationLockedUntil: null } });
    return 'sent';
  } catch {
    await Requests.updateOne(claim, { $set: { notificationStatus: 'failed', notificationLockedUntil: new Date(+now + 5 * 60_000) } });
    return 'failed';
  }
};

export const runRegistrationNotifications = async (options = {}) => {
  for (let i = 0; i < 10; i++) {
    const status = await deliverRegistrationNotification(options);
    if (status === 'idle' || status === 'unconfigured') break;
  }
};
