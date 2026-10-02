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
export const isExistingActiveInviteAccount = (user) => Boolean(user && user.isActive !== false);

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

export const INVITE_ROLES = ['captain', 'bar captain', 'uniform packer'];
export const isValidInviteEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const normalizeInviteCc = (value) => {
  const addresses = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  const emails = [...new Set(addresses.map(normalizeInviteEmail).filter(Boolean))];
  if (emails.length > 5 || emails.some((email) => !isValidInviteEmail(email))) {
    throw new Error('Enter up to 5 valid CC email addresses');
  }
  return emails;
};

export const renderUserInviteEmail = ({ name, inviteUrl, role = 'captain', active = false }) => {
  const barCaptain = role === 'bar captain';
  const uniformPacker = role === 'uniform packer';
  const introduction = uniformPacker ? 'Your OCC uniform packing workspace is ready.' : barCaptain
    ? 'We are introducing a new system for tracking alcohol inventory and completing event reports at OCC.'
    : 'We are introducing a new system for completing event reports at OCC.';
  const registration = active
    ? 'Your account is already active. Sign in with your existing password:'
    : 'Create your password using this private registration link:';
  const expiry = active ? '' : 'This link is private and expires in 72 hours.';
  const steps = uniformPacker ? [
    'Sign in and open Uniform Packing. Select the event you are preparing.',
    'Check the booked staff and open positions. Download the staffing roster with jacket, shirt, pants and shoe sizes.',
    'Review the event’s decor and uniform boards. If sizes are missing, upload the Nowsta Staffing Roster CSV for that event.',
    'Select uniform items and sizes, enter the quantities you are sending, and save the packout.',
    'Print labels from the saved packout. If you forget your password, use Forgot password on the login page.',
  ] : [
    'Sign in and open My Events. Select the correct assigned event.',
    'Open Captain’s Report, complete the event report, include relevant notes, and submit it when finished.',
    ...(barCaptain ? [
      'Open Bar Returns for the same event. Check Sent, Received and Returned quantities for every beverage item and correct them where needed.',
      'Use Save quantities to save your progress. Add any unlisted alcohol and notes for missing or damaged items.',
      'Submit final Bar Returns before leaving the venue or immediately after returning to the shop. Submit Captain’s Report separately; completing one does not submit the other.',
    ] : []),
    'If an assigned event is missing or you need help registering, contact me directly.',
  ];
  const subject = uniformPacker ? 'OCC — your uniform packing workspace' : barCaptain
    ? 'OCC — new alcohol inventory and event reporting system'
    : 'OCC — new event reporting system';
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;max-width:620px"><p>Hi ${escapeHtml(name || 'Captain')},</p><p>${escapeHtml(introduction)}</p><p>${escapeHtml(registration)}</p><p><a href="${escapeHtml(inviteUrl)}">${active ? 'Sign in' : 'Create my account'}</a></p>${expiry ? `<p>${expiry}</p>` : ''}<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol><p>Thank you,<br><strong>Ivan</strong><br>Oliver Cheng Catering &amp; Events</p></div>`,
    text: [`Hi ${clean(name || 'Captain', 200)},`, introduction, registration, inviteUrl, expiry,
      steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
      'Thank you,\nIvan\nOliver Cheng Catering & Events'].filter(Boolean).join('\n\n'),
  };
};

export const sendUserInviteEmail = async ({ email, name, inviteUrl, role = 'captain', active = false, cc = [], fetchImpl = fetch }) => {
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', error: 'RESEND_API_KEY is not configured' };
  const recipient = normalizeInviteEmail(email);
  const copies = normalizeInviteCc(cc).filter((address) => address !== recipient);
  const message = renderUserInviteEmail({ name, inviteUrl, role, active });
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: clean(process.env.USER_INVITE_FROM, 320) || 'Ivan at OCC <reports@reports.occdecks.com>',
      reply_to: clean(process.env.USER_INVITE_REPLY_TO, 320) || 'ivan@ocnyc.com',
      to: [recipient], ...(copies.length ? { cc: copies } : {}),
      subject: message.subject, html: message.html, text: message.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) return { status: 'failed', error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date() };
};
