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

export const isCaptainShift = (value) => (
  /\b(captain|ma[iî]tre\s*['’]?\s*d|lead server)\b/i.test(String(value || ''))
);

export const matchNowstaCaptainUserIds = ({ event, users } = {}) => {
  const captainByName = new Map();
  (Array.isArray(users) ? users : []).forEach((user) => {
    const emailName = String(user?.email || '').split('@')[0];
    [user?.nowstaName, user?.username, emailName].forEach((candidate) => {
      nowstaPersonKeys(candidate).forEach((key) => {
        if (key && !captainByName.has(key)) captainByName.set(key, user?._id || user?.id);
      });
    });
  });

  const ids = new Set();
  const shifts = Array.isArray(event?.meta?.nowsta?.shifts) ? event.meta.nowsta.shifts : [];
  shifts.forEach((shift) => {
    if (!isCaptainShift(shift?.position)) return;
    (Array.isArray(shift?.workers) ? shift.workers : []).forEach((worker) => {
      const status = String(worker?.status || '').trim().toLowerCase();
      if (status && !['confirmed', 'assigned'].includes(status)) return;
      const matched = nowstaPersonKeys(worker?.name)
        .map((key) => captainByName.get(key))
        .find(Boolean);
      if (matched) ids.add(String(matched));
    });
  });
  return [...ids];
};
