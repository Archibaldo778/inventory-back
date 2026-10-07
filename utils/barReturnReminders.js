import crypto from 'node:crypto';
import Event from '../models/Event.js';
import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import BarReturnReminder from '../models/BarReturnReminder.js';
import { nowstaPersonKeys } from './nowstaCaptainAssignments.js';
import { resolveUserInvitationSender } from './userInvitationSender.js';
import { issueEventGuestAccess } from './eventGuestAccess.js';
import { barReturnsAppOrigin } from './barReturnsLinks.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const clean = (value) => String(value || '').trim();
const validEmail = (value) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const closed = (event) => ['submitted', 'reviewed', 'closed'].includes(event?.status);
const fail = (message, status = 409) => Object.assign(new Error(message), { statusCode: status });
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const selectBarReturnCaptains = ({ schedule, users = [], assignedUserIds = [] }) => {
  if (schedule?.archived || schedule?.excluded) return [];
  const active = users.filter((user) => user.isActive !== false && ['captain', 'bar captain'].includes(user.role));
  const shifts = schedule?.shifts;
  const candidates = Array.isArray(shifts) ? shifts.flatMap((shift) => {
    const position = clean(shift.position).replace(/[_-]/g, ' ');
    if (!/\bcaptain\b/i.test(position) || /\bsanitation\b/i.test(position)) return [];
    return (shift.workers || []).filter((worker) => ['confirmed', 'assigned'].includes(clean(worker.status).toLowerCase()))
      .map((worker) => ({ ...worker, position: shift.position }));
  }) : active.filter((user) => assignedUserIds.map(String).includes(String(user._id)))
    .map((user) => ({ name: user.username, email: user.email, position: user.role }));
  const barCaptains = candidates.filter((worker) => /\bbar\b/i.test(worker.position));
  const selected = barCaptains.length ? barCaptains : candidates;
  const unique = new Map();
  for (const worker of selected) {
    const matches = active.filter((user) => worker.email
      ? clean(user.email).toLowerCase() === clean(worker.email).toLowerCase()
      : [user.nowstaName, user.username].flatMap(nowstaPersonKeys).some((key) => nowstaPersonKeys(worker.name).includes(key)));
    const email = clean(worker.email || (matches.length === 1 ? matches[0].email : '')).toLowerCase();
    const identity = email || clean(worker.companyUserId) || nowstaPersonKeys(worker.name)[0];
    if (!identity) continue;
    const id = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32);
    if (!unique.has(id)) unique.set(id, { id, name: clean(worker.name) || email, position: clean(worker.position), email: validEmail(email) ? email : '' });
  }
  return [...unique.values()];
};

export const loadBarReturnCaptains = async (barEvent) => {
  if (!barEvent.linkedEventId) return [];
  const event = await Event.findById(barEvent.linkedEventId).select('meta.nowsta status').lean();
  if (!event || /^deleted$/i.test(event.status || '')) return [];
  const nowsta = event.meta?.nowsta;
  const schedule = nowsta?.apiEventId ? await NowstaScheduleEntry.findOne({ nowstaEventId: nowsta.apiEventId }).lean() : null;
  const users = await User.find({ role: { $in: ['captain', 'bar captain'] }, isActive: { $ne: false } })
    .select('username nowstaName email role isActive').lean();
  return selectBarReturnCaptains({ schedule: schedule || (nowsta?.apiEventId ? { ...nowsta, shifts: nowsta.shifts || [] } : nowsta), users, assignedUserIds: barEvent.assignedUserIds || [] });
};

export const deliverBarReturnReminder = async ({ event, recipient, sender, fetchImpl = globalThis.fetch,
  Reminder = BarReturnReminder, now = new Date(), apiKey = process.env.RESEND_API_KEY,
  makeToken = issueEventGuestAccess,
}) => {
  if (closed(event)) throw fail('Returns have already been submitted');
  if (!event.linkedEventId || !validEmail(recipient?.email)) throw fail('This captain does not have an email address available');
  if (!apiKey) throw fail('Email delivery is not configured', 503);
  const identity = resolveUserInvitationSender(sender);
  const id = `${event._id}:${recipient.id}`;
  const attemptId = crypto.randomUUID();
  try {
    const claim = await Reminder.findOneAndUpdate({ _id: id, lockedUntil: { $lte: now } }, { $set: {
      eventId: event._id, recipient: recipient.email, senderId: clean(sender.userId), senderName: identity.name,
      attemptId, lockedUntil: new Date(now.getTime() + 10 * 60_000), status: 'pending', error: '',
    } }, { upsert: true, new: true });
    if (!claim) throw fail('A reminder was recently requested. Please wait 10 minutes.', 429);
  } catch (error) {
    if (error.code === 11000) throw fail('A reminder was recently requested. Please wait 10 minutes.', 429);
    throw error;
  }
  try {
    const token = makeToken({ eventIds: [String(event.linkedEventId)], capability: 'bar:returns',
      subjectId: recipient.email, expiresAt: new Date(now.getTime() + 7 * 86400000), context: 'manual-bar-return-reminder' });
    const url = `${barReturnsAppOrigin()}/bar/returns?event=${encodeURIComponent(event.linkedEventId)}&access=${encodeURIComponent(token)}`;
    const text = `Hi ${recipient.name},\n\nPlease complete the bar returns for ${event.name} (${event.eventDate}).\n\nComplete bar returns: ${url}\n\nThank you,\n${identity.name}`;
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `bar-return-${attemptId}` },
      body: JSON.stringify({ from: identity.from, reply_to: identity.email, to: [recipient.email],
        subject: `Bar returns reminder · ${clean(event.name).replace(/[\r\n]/g, ' ')} · ${event.eventDate}`,
        text, html: `<p>Hi ${escapeHtml(recipient.name)},</p><p>Please complete the bar returns for <strong>${escapeHtml(event.name)}</strong> (${escapeHtml(event.eventDate)}).</p><p><a href="${escapeHtml(url)}">Complete bar returns</a></p><p>Thank you,<br>${escapeHtml(identity.name)}</p>` }),
    }, { fetchImpl, timeoutMs: 20_000 });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id) throw fail(payload.message || 'Could not send the reminder', 502);
    await Reminder.updateOne({ _id: id, attemptId }, { $set: { status: 'sent', sentAt: now, providerId: payload.id } });
    return { sentAt: now, recipientName: recipient.name };
  } catch (error) {
    await Reminder.updateOne({ _id: id, attemptId }, { $set: { status: 'failed', error: clean(error.message).slice(0, 500) } });
    throw error;
  }
};
