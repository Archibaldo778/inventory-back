import User from '../models/Users.js';
import { resolveAutomaticEmailSender } from './userInvitationSender.js';
import { createUserInviteToken, INVITE_ROLES, isValidInviteEmail, userInviteUrl } from './userInvitations.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

export const INVITE_REMINDER_WINDOW_MS = 5 * 60 * 60 * 1000;
const clean = (value) => String(value || '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export const dueUserInviteRemindersQuery = (now) => ({
  role: { $in: INVITE_ROLES },
  isActive: false,
  inviteAcceptedAt: null,
  inviteSentAt: { $ne: null, $lte: now },
  inviteTokenHash: { $type: 'string', $ne: '' },
  inviteExpiresAt: { $gt: now, $lte: new Date(now.getTime() + INVITE_REMINDER_WINDOW_MS) },
  inviteReminderAttemptedAt: null,
});

export const renderUserInviteReminder = ({ user, token }) => {
  const sender = resolveAutomaticEmailSender();
  const deadline = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short',
  }).format(new Date(user.inviteExpiresAt));
  const url = userInviteUrl(token);
  const name = clean(user.username || user.nowstaName) || 'there';
  const instruction = 'You have not finished setting up your OCC account. Please create your password before your invitation expires.';
  return {
    from: sender.from,
    reply_to: sender.email,
    to: [clean(user.email).toLowerCase()],
    subject: 'Reminder: your OCC account invitation expires soon',
    text: `Hi ${name},\n\n${instruction}\n\nCreate my account: ${url}\n\nExpires: ${deadline} (New York time). Your original invitation link is also valid until this deadline.\n\nIf you need help, reply to this email.\n\nThank you,\n${sender.name}\nOliver Cheng Catering & Events`,
    html: `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:620px"><p>Hi ${escapeHtml(name)},</p><p>${instruction}</p><p><a href="${escapeHtml(url)}">Create my account</a></p><p>Expires: <strong>${escapeHtml(deadline)} (New York time)</strong>.<br>Your original invitation link is also valid until this deadline.</p><p>If you need help, reply to this email.</p><p>Thank you,<br><strong>${escapeHtml(sender.name)}</strong><br>Oliver Cheng Catering &amp; Events</p></div>`,
  };
};

export const deliverUserInviteReminder = async ({ user, now = new Date(), fetchImpl = globalThis.fetch }) => {
  if (!clean(process.env.RESEND_API_KEY) || !isValidInviteEmail(user.email)) return 'skipped';
  const reminder = createUserInviteToken();
  // Claim once per invitation, before the network call, across processes/restarts.
  // Do not retry an uncertain send: a manual new invitation resets this claim.
  const claimed = await User.findOneAndUpdate({
    ...dueUserInviteRemindersQuery(now), _id: user._id, inviteTokenHash: user.inviteTokenHash,
  }, { $set: { inviteReminderAttemptedAt: now, inviteReminderTokenHash: reminder.tokenHash, inviteReminderError: '' } }, { new: true })
    .select('_id username nowstaName email inviteExpiresAt inviteSender');
  if (!claimed) return 'skipped';
  const identity = { _id: user._id, inviteTokenHash: user.inviteTokenHash, inviteReminderTokenHash: reminder.tokenHash };
  // Registration or a replacement invitation while this job was claiming must stop delivery.
  if (!await User.exists({ ...identity, isActive: false, inviteAcceptedAt: null, inviteExpiresAt: { $gt: now } })) return 'skipped';
  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `invite-reminder:${user._id}:${user.inviteTokenHash}`,
      },
      body: JSON.stringify(renderUserInviteReminder({ user: claimed, token: reminder.token })),
    }, { fetchImpl, timeoutMs: 20_000 });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id) throw new Error(`Invitation reminder provider HTTP ${response.status || 'error'}`);
    await User.updateOne(identity, { $set: { inviteReminderSentAt: now, inviteReminderError: '' } });
    return 'sent';
  } catch {
    await User.updateOne(identity, { $set: { inviteReminderError: 'Delivery failed or unconfirmed; automatic retry suppressed to avoid duplicate emails.' } });
    return 'failed';
  }
};

let running = false;
export const runUserInviteReminders = async ({ now, fetchImpl = globalThis.fetch } = {}) => {
  const summary = { sent: 0, failed: 0, skipped: 0 };
  if (running || !clean(process.env.RESEND_API_KEY)) return summary;
  running = true;
  try {
    const users = await User.find(dueUserInviteRemindersQuery(now || new Date()))
      .select('_id email +inviteTokenHash').limit(100).lean();
    for (const user of users) {
      try { summary[await deliverUserInviteReminder({ user, now: now || new Date(), fetchImpl })] += 1; }
      catch { summary.failed += 1; }
    }
    return summary;
  } finally { running = false; }
};
