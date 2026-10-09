import { requiresCaptainReport } from './eventReportRequirement.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import User from '../models/Users.js';
import { nowstaPersonKeys } from './nowstaCaptainAssignments.js';

export const isCaptainPosition = (position) => /\bcaptain\b/i.test(String(position || '').replace(/[_-]+/g, ' '));

export const captainAssignedShifts = (schedule, user) => {
  if (schedule?.archived || schedule?.excluded) return [];
  const email = String(user?.email || '').trim().toLowerCase();
  const names = new Set([user?.nowstaName, user?.username, email.split('@')[0]].flatMap(nowstaPersonKeys));
  return (schedule?.shifts || []).filter((shift) => (shift.workers || []).some((worker) => {
    if (!['confirmed', 'assigned'].includes(String(worker.status || '').trim().toLowerCase())) return false;
    if (worker.email) return String(worker.email).trim().toLowerCase() === email;
    return nowstaPersonKeys(worker.name).some((key) => names.has(key));
  }));
};

export const captainEventDuties = ({ event, schedule, user }) => {
  const nowsta = event?.meta?.nowsta;
  // Manually assigned events without Nowsta keep their existing access rules.
  const hasBooking = Boolean(schedule?.shifts || nowsta?.apiEventId || nowsta?.shifts);
  const shifts = captainAssignedShifts(schedule?.shifts ? schedule : nowsta, user);
  return {
    reportRequired: requiresCaptainReport(event, schedule),
    captainAssigned: !hasBooking || shifts.some((shift) => isCaptainPosition(shift.position)),
    positions: [...new Set(shifts.map((shift) => shift.position).filter(Boolean))],
  };
};

export const loadCaptainEventDuties = async (event, user) => {
  const nowstaEventId = event?.meta?.nowsta?.apiEventId;
  const schedule = nowstaEventId ? await NowstaScheduleEntry.findOne({ nowstaEventId })
    .select('nowstaEventId title date endsAt archived shifts').lean() : null;
  return { ...captainEventDuties({ event, schedule, user }), schedule };
};

export const loadCaptainEventDutiesBatch = async (events, user) => {
  const ids = [...new Set(events.map((event) => event.meta?.nowsta?.apiEventId).filter(Boolean))];
  const schedules = ids.length ? await NowstaScheduleEntry.find({ nowstaEventId: { $in: ids } })
    .select('nowstaEventId title date endsAt archived shifts').lean() : [];
  const byId = new Map(schedules.map((schedule) => [String(schedule.nowstaEventId), schedule]));
  return new Map(events.map((event) => {
    const schedule = byId.get(String(event.meta?.nowsta?.apiEventId));
    return [String(event._id), { ...captainEventDuties({ event, schedule, user }), schedule }];
  }));
};

export const reportCaptainStillAssigned = async (report, event) => {
  if (report.reportType === 'kitchen' || report.status === 'submitted') return true;
  if (!event?.meta?.nowsta?.apiEventId && !event?.meta?.nowsta?.shifts) return true;
  const accountId = /^account:([a-f0-9]{24})$/i.exec(report.slackUserId || '')?.[1];
  const user = accountId ? await User.findById(accountId).select('username nowstaName email isActive').lean()
    : { username: report.reporterName, email: report.reporterEmail };
  if (!user || user.isActive === false) return false;
  return (await loadCaptainEventDuties(event, user)).captainAssigned;
};
