import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';

export const normalizeNowstaPersonName = (value) => String(value || '')
  .replace(/\u00a0/g, ' ')
  .replace(/^zz\s+[^-]+\s+-\s+/i, '')
  .replace(/\s*\(agency\)\s*/gi, ' ')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const nowstaPersonKeys = (value) => {
  const normalized = normalizeNowstaPersonName(value);
  return normalized ? [normalized, normalized.replace(/\s+/g, '')] : [];
};

export const matchNowstaCaptainUserIds = ({ event, users, schedule } = {}) => {
  const captainByName = new Map();
  const byEmail = new Map();
  (Array.isArray(users) ? users : []).forEach((user) => {
    const address = String(user?.email || '').trim().toLowerCase();
    if (address) byEmail.set(address, byEmail.has(address) ? null : user?._id || user?.id);
    const emailName = String(user?.email || '').split('@')[0];
    [user?.nowstaName, user?.username, emailName].forEach((candidate) => {
      nowstaPersonKeys(candidate).forEach((key) => {
        if (key) {
          const id = user?._id || user?.id;
          if (!captainByName.has(key)) captainByName.set(key, id);
          else if (String(captainByName.get(key)) !== String(id)) captainByName.set(key, null);
        }
      });
    });
  });

  const ids = new Set();
  const source = schedule === undefined ? event?.meta?.nowsta : schedule;
  const shifts = !source?.archived && !source?.excluded && Array.isArray(source?.shifts) ? source.shifts : [];
  shifts.forEach((shift) => {
    (Array.isArray(shift?.workers) ? shift.workers : []).forEach((worker) => {
      const status = String(worker?.status || '').trim().toLowerCase();
      if (status && !['confirmed', 'assigned'].includes(status)) return;
      if (worker?.removed_at) return;
      const address = String(worker?.email || '').trim().toLowerCase();
      if (address) {
        const matched = byEmail.get(address);
        if (matched) ids.add(String(matched));
        return;
      }
      const matched = nowstaPersonKeys(worker?.name)
        .map((key) => captainByName.get(key))
        .find(Boolean);
      if (matched) ids.add(String(matched));
    });
  });
  return [...ids];
};

export const loadNowstaCaptainAssignments = async (events, users, { Schedules = NowstaScheduleEntry } = {}) => {
  const ids = [...new Set(events.map((event) => event.meta?.nowsta?.apiEventId).filter(Boolean).map(String))];
  const schedules = ids.length ? await Schedules.find({ nowstaEventId: { $in: ids } }).select('nowstaEventId archived shifts').lean() : [];
  const byId = new Map(schedules.map((schedule) => [String(schedule.nowstaEventId), schedule]));
  return new Map(events.map((event) => [String(event._id), matchNowstaCaptainUserIds({ event, users,
    schedule: event.meta?.nowsta?.apiEventId ? byId.get(String(event.meta.nowsta.apiEventId)) || null : undefined,
  })]));
};
