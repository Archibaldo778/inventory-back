import { canUseKitchenReport } from './eventStaffAccess.js';
import { requiresEventReport } from './eventReportRequirement.js';

const clean = (value) => String(value || '').trim();
const nameKey = (value) => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const emailKey = (value) => clean(value).toLowerCase();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const workerMatchesStaff = (worker, user) => {
  if (!['confirmed', 'assigned'].includes(emailKey(worker?.status))) return false;
  const workerEmail = emailKey(worker?.email);
  if (workerEmail) return Boolean(emailKey(user?.email)) && workerEmail === emailKey(user?.email);
  const expected = nameKey(user?.nowstaName || user?.username);
  return Boolean(expected) && nameKey(worker?.name) === expected;
};

export const staffScheduleQuery = (user) => {
  const identities = [];
  if (clean(user?.email)) identities.push({ email: new RegExp(`^${escapeRegex(clean(user.email))}$`, 'i') });
  const name = clean(user?.nowstaName || user?.username);
  if (name) identities.push({ name: new RegExp(`^\\s*${name.split(/\s+/).map(escapeRegex).join('\\s+')}\\s*$`, 'i') });
  return { archived: { $ne: true }, 'shifts.workers': { $elemMatch: {
    status: { $in: ['confirmed', 'assigned'] },
    $or: identities.length ? identities : [{ name: { $in: [] } }],
  } } };
};

export const serializeStaffEvent = (entry, user) => {
  if (!entry || entry.archived) return null;
  const shifts = (entry.shifts || []).filter((shift) => (shift.workers || []).some((worker) => workerMatchesStaff(worker, user)))
    .map((shift) => ({ position: shift.position, startTime: shift.startTime, endTime: shift.endTime }));
  if (!shifts.length) return null;
  return {
    id: String(entry.nowstaEventId), title: entry.title, client: entry.client, date: entry.date,
    venue: entry.venue, address: entry.address, guestCount: entry.guestCount,
    timeZone: entry.timeZone, shifts, reportRequired: requiresEventReport(entry),
    canUseKitchenReport: requiresEventReport(entry) && canUseKitchenReport(user, shifts),
  };
};
