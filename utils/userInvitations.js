import crypto from 'node:crypto';

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const escapeHtml = (value) => clean(value, 2000)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const normalizeInviteEmail = (value) => clean(value, 320).toLowerCase();

export const hashUserInviteToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

export const createUserInviteToken = ({ now = Date.now() } = {}) => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashUserInviteToken(token), expiresAt: new Date(Number(now) + INVITE_TTL_MS) };
};

export const userInviteUrl = (token) => {
  const origin = clean(
    process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN
      || process.env.CLIENT_URL || process.env.APP_URL || 'https://occdecks.com',
    1000,
  ).replace(/\/+$/, '');
  return `${origin}/accept-invite?token=${encodeURIComponent(token)}`;
};

export const renderUserInviteEmail = ({ name, inviteUrl }) => {
  const safeName = escapeHtml(name || 'Captain');
  const safeUrl = escapeHtml(inviteUrl);
  return {
    subject: 'Set up your OCC beverage returns account',
    html: `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:620px"><p>Hi ${safeName},</p><p>We are introducing a new beverage inventory and return tracking system for upcoming events.</p><p>Use your personal registration link below to create your password:</p><p><a href="${safeUrl}" style="display:inline-block;background:#1f2937;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Create my account</a></p><p>This link is private and expires in 72 hours.</p><p>After registering, sign in, open <strong>My Events</strong>, select the correct event, enter the returned quantity for every beverage item, add any unlisted alcohol, include notes for missing or damaged items, and submit the return report.</p><p>Please complete the return before leaving the venue or immediately after returning to the shop.</p><p>If you have trouble registering, contact me directly.</p><p>Thank you,<br><strong>Ivan</strong><br>Oliver Cheng Catering &amp; Events</p></div>`,
    text: `Hi ${clean(name || 'Captain', 200)},\n\nWe are introducing a new beverage inventory and return tracking system for upcoming events.\n\nCreate your password using this private registration link:\n${inviteUrl}\n\nThe link expires in 72 hours.\n\nAfter registering, sign in, open My Events, select the correct event, enter returned quantities, add any unlisted alcohol, include notes for missing or damaged items, and submit the return report. Please complete the return before leaving the venue or immediately after returning to the shop.\n\nIf you have trouble registering, contact me directly.\n\nThank you,\nIvan\nOliver Cheng Catering & Events`,
  };
};

export const sendUserInviteEmail = async ({ email, name, inviteUrl, fetchImpl = fetch }) => {
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', error: 'RESEND_API_KEY is not configured' };
  const recipient = normalizeInviteEmail(email);
  const message = renderUserInviteEmail({ name, inviteUrl });
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: clean(process.env.USER_INVITE_FROM, 320) || 'Ivan at OCC <reports@reports.occdecks.com>',
      reply_to: clean(process.env.USER_INVITE_REPLY_TO, 320) || 'ivan@ocnyc.com',
      to: [recipient], subject: message.subject, html: message.html, text: message.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) return { status: 'failed', error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date() };
};
