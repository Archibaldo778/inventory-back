import crypto from 'node:crypto';
import { resolveUserInvitationSender } from './userInvitationSender.js';
import { ACCOUNT_ROLES } from './departmentAccess.js';

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const escapeHtml = (value) => clean(value, 2000)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const normalizeInviteEmail = (value) => clean(value, 320).toLowerCase();
export const isExistingActiveInviteAccount = (user) => Boolean(user && user.isActive !== false);

export const hashUserInviteToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

export const createUserInviteToken = ({ now = Date.now() } = {}) => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashUserInviteToken(token), expiresAt: new Date(Number(now) + INVITE_TTL_MS) };
};

export const userInviteTokenQuery = (token, now = new Date()) => ({
  $or: [
    { inviteTokenHash: hashUserInviteToken(token) },
    { inviteReminderTokenHash: hashUserInviteToken(token) },
  ],
  isActive: false,
  inviteExpiresAt: { $gt: now },
  inviteAcceptedAt: null,
});

export const userInviteUrl = (token) => {
  const origin = clean(
    process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN
      || process.env.CLIENT_URL || process.env.APP_URL || 'https://occdecks.com',
    1000,
  ).replace(/\/+$/, '');
  return `${origin}/accept-invite?token=${encodeURIComponent(token)}`;
};

export const INVITE_ROLES = ACCOUNT_ROLES;
export const canInviteUserAsRole = (currentRole, inviteRole) => INVITE_ROLES.includes(inviteRole)
  && (currentRole === inviteRole || (['captain', 'bar captain'].includes(currentRole) && ['captain', 'bar captain'].includes(inviteRole)));
export const isValidInviteEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const normalizeInviteCc = (value) => {
  const addresses = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  const emails = [...new Set(addresses.map(normalizeInviteEmail).filter(Boolean))];
  if (emails.length > 5 || emails.some((email) => !isValidInviteEmail(email))) {
    throw new Error('Enter up to 5 valid CC email addresses');
  }
  return emails;
};

export const renderUserInviteEmail = ({ name, inviteUrl, role = 'captain', active = false, sender }) => {
  const identity = resolveUserInvitationSender(sender);
  const kitchenLead = role === 'kitchen lead';
  const barCaptain = role === 'bar captain';
  const uniformPacker = role === 'uniform packer';
  const captain = role === 'captain' || barCaptain;
  const assignedChef = role === 'event staff';
  const departmentAdmin = ['kitchen admin', 'staffing admin'].includes(role);
  const introduction = kitchenLead || assignedChef ? 'We are introducing a new system for completing Kitchen Reports at OCC.' : uniformPacker ? 'Your OCC uniform packing workspace is ready.' : barCaptain
    ? 'We are introducing a new system for tracking alcohol inventory and completing event reports at OCC.'
    : captain ? 'We are introducing a new system for completing event reports at OCC.' : 'Your OCC workspace account is ready.';
  const registration = active
    ? 'Your account is already active. Sign in with your existing password:'
    : 'Create your password using this private registration link:';
  const expiry = active ? '' : 'This link is private and expires in 30 days.';
  const steps = kitchenLead || assignedChef ? [
    'Sign in and open My Events. You will see your confirmed Nowsta assignments.',
    'Open the event where you are booked as Lead Chef, Kitchen Lead, Proofer Lead or Executive Chef, then select Kitchen Report.',
    'Complete the report within 48 hours after the event. Include any staffing, food, equipment or service issues and submit it when finished.',
    'If you forget your password, use Forgot password on the login page.',
    'If an assigned event is missing or you need help registering, contact me directly.',
  ] : uniformPacker ? [
    'Sign in and open Events. Select the event you are preparing.',
    'Check the booked staff, open positions and sizes in Staff & Uniform. Saved staff sizes are used first, then sizes supplied by Nowsta.',
    'Review the uniform requirements from Nowsta or Staff Request. Confirm any missing sizes before packing. You can also view submitted event reports.',
    'Select uniform items and sizes, enter the quantities you are sending, and save the packout.',
    'Print labels from the saved packout. If you forget your password, use Forgot password on the login page.',
  ] : captain ? [
    'Sign in and open My Events. Select the correct assigned event.',
    'Open Captain’s Report, complete the event report, include relevant notes, and submit it when finished.',
    ...(barCaptain ? [
      'Open Bar Returns for the same event. Check Sent, Received and Returned quantities for every beverage item and correct them where needed.',
      'Use Save quantities to save your progress. Add any unlisted alcohol and notes for missing or damaged items.',
      'Submit final Bar Returns before leaving the venue or immediately after returning to the shop. Submit Captain’s Report separately; completing one does not submit the other.',
    ] : []),
    'If an assigned event is missing or you need help registering, contact me directly.',
  ] : [
    role === 'bartender' ? 'Sign in and open My Events to view your bar assignments.'
      : role === 'packer' ? 'Sign in and open the Packing Station to prepare event inventory.'
        : 'Sign in and open Events to find the event you are working on.',
    ...(departmentAdmin ? [
      `Open Admin to manage ${role === 'kitchen admin' ? 'kitchen' : 'staffing'} operations and reports.`,
      'Open User Administration and select Send invitations to invite staff in your department. Each employee receives a personal registration link.',
    ] : []),
    'Use the sections available to your account for your work. If you need help or an access change, contact your administrator.',
    'If you forget your password, use Forgot password on the login page.',
  ];
  const subject = kitchenLead || assignedChef ? 'OCC — Kitchen Reports: create your account' : uniformPacker ? 'OCC — your uniform packing workspace' : barCaptain
    ? 'OCC — new alcohol inventory and event reporting system'
    : captain ? 'OCC — new event reporting system' : 'OCC — your workspace invitation';
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:620px"><p>Hi ${escapeHtml(name || (kitchenLead ? 'Chef' : 'Captain'))},</p><p>${escapeHtml(introduction)}</p><p>${escapeHtml(registration)}</p><p><a href="${escapeHtml(inviteUrl)}">${active ? 'Sign in' : 'Create my account'}</a></p>${expiry ? `<p>${expiry}</p>` : ''}<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol><p>Thank you,<br><strong>${escapeHtml(identity.name)}</strong><br>Oliver Cheng Catering &amp; Events</p></div>`,
    text: [`Hi ${clean(name || (kitchenLead ? 'Chef' : 'Captain'), 200)},`, introduction, registration, inviteUrl, expiry,
      steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
      `Thank you,\n${identity.name}\nOliver Cheng Catering & Events`].filter(Boolean).join('\n\n'),
  };
};

export const sendUserInviteEmail = async ({ email, name, inviteUrl, role = 'captain', active = false, cc = [], sender, fetchImpl = fetch }) => {
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', error: 'RESEND_API_KEY is not configured' };
  const recipient = normalizeInviteEmail(email);
  const copies = normalizeInviteCc(cc).filter((address) => address !== recipient);
  const identity = resolveUserInvitationSender(sender);
  const message = renderUserInviteEmail({ name, inviteUrl, role, active, sender });
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: identity.from,
      reply_to: identity.email,
      to: [recipient],
      subject: message.subject, html: message.html, text: message.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) return { status: 'failed', error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  const delivery = { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date() };
  if (copies.length) {
    // A copy must never contain the personal registration credential. Failure
    // here must not mark the already-delivered invitation for a retry.
    try {
      const notification = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: identity.from, reply_to: identity.email, to: copies,
          subject: `OCC — invitation sent to ${clean(name, 160)}`,
          text: `Invitation sent to ${clean(name, 160)} (${recipient}). The employee received their own email with sign-in instructions.`,
          html: `<p>Invitation sent to <strong>${escapeHtml(name)}</strong> (${escapeHtml(recipient)}).</p><p>The employee received their own email with sign-in instructions.</p>`,
        }),
      });
      const notificationPayload = await notification.json().catch(() => ({}));
      delivery.copyDelivery = notification.ok && notificationPayload?.id
        ? { status: 'sent', providerId: clean(notificationPayload.id, 200) }
        : { status: 'failed', error: clean(notificationPayload?.message || `Resend HTTP ${notification.status}`, 1000) };
    } catch {
      delivery.copyDelivery = { status: 'failed', error: 'Could not send the invitation notification' };
    }
  }
  return delivery;
};
