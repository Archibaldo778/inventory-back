const clean = (value, maxLength = 300) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

export const normalizePersonName = (value) => clean(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const staffFullName = (staff = {}) => clean([
  staff?.firstName || staff?.meta?.firstName,
  staff?.lastName || staff?.meta?.lastName,
].filter(Boolean).join(' '));

export const isOperationsDriverShift = (entry, shift) => {
  const position = clean(shift?.position);
  if (position) return /\bdriver\b|\bdeliver(?:y|ies)\b|\bhand deliver/i.test(position);
  return /\bdriver\b|\bdeliver(?:y|ies)\b|\bhand deliver/i.test([
    entry?.departmentName,
    entry?.title,
  ].filter(Boolean).join(' '));
};

const splitName = (fullName) => {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' '),
  };
};

export const buildOperationsPeople = (scheduleEntries = []) => {
  const byId = new Map();
  (Array.isArray(scheduleEntries) ? scheduleEntries : []).forEach((entry) => {
    (Array.isArray(entry?.shifts) ? entry.shifts : []).forEach((shift) => {
      if (!isOperationsDriverShift(entry, shift)) return;
      (Array.isArray(shift?.workers) ? shift.workers : []).forEach((worker) => {
        const fullName = clean(worker?.name);
        const nowstaCompanyUserId = clean(worker?.companyUserId, 120);
        if (!fullName || !nowstaCompanyUserId) return;
        const current = byId.get(nowstaCompanyUserId) || {
          nowstaCompanyUserId,
          fullName,
          ...splitName(fullName),
          email: clean(worker?.email, 240).toLowerCase(),
          phone: clean(worker?.phone, 80),
          roles: new Set(),
          departments: new Set(),
        };
        current.roles.add(clean(shift?.position, 160) || 'Driver');
        if (clean(entry?.departmentName, 160)) current.departments.add(clean(entry.departmentName, 160));
        byId.set(nowstaCompanyUserId, current);
      });
    });
  });
  return [...byId.values()].map((person) => ({
    ...person,
    roles: [...person.roles],
    departments: [...person.departments],
  }));
};

export const matchStaffByName = (person, staff = []) => {
  const target = normalizePersonName(person?.fullName || person?.name);
  if (!target) return null;
  return (Array.isArray(staff) ? staff : []).find((candidate) => (
    normalizePersonName(staffFullName(candidate)) === target
  )) || null;
};
