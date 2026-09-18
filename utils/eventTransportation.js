import crypto from 'crypto';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const buildTransportationRow = (input = {}, { staff = null } = {}) => {
  const staffName = staff ? [staff.firstName, staff.lastName].map(clean).filter(Boolean).join(' ') : '';
  return {
    id: clean(input?.id) || crypto.randomUUID(),
    driverStaffId: staff ? String(staff._id) : (clean(input?.driverStaffId) || null),
    name: clean(input?.name) || staffName,
    phone: clean(input?.phone),
    role: clean(input?.role),
    vehicle: clean(input?.vehicle),
    callTime: clean(input?.callTime),
    departureTime: clean(input?.departureTime),
    arrivalTime: clean(input?.arrivalTime),
    pickupTime: clean(input?.pickupTime),
    notes: clean(input?.notes),
    address: clean(input?.address),
    source: input?.source === 'dropbox' ? 'dropbox' : 'manual',
  };
};

const PATCHABLE_FIELDS = [
  'name', 'phone', 'role', 'vehicle', 'callTime', 'departureTime',
  'arrivalTime', 'pickupTime', 'notes', 'address',
];

export const buildTransportationPatch = (input = {}, { staff = null } = {}) => {
  const patch = {};
  PATCHABLE_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = clean(input[key]);
  });
  if (staff) {
    patch.driverStaffId = String(staff._id);
    if (!clean(patch.name)) {
      patch.name = [staff.firstName, staff.lastName].map(clean).filter(Boolean).join(' ');
    }
  } else if (Object.prototype.hasOwnProperty.call(input, 'driverStaffId') && !clean(input.driverStaffId)) {
    patch.driverStaffId = null;
  }
  return patch;
};

export const addTransportationRow = (rows, row) => [...(Array.isArray(rows) ? rows : []), row];

export const updateTransportationRow = (rows, rowId, patch) => {
  let found = false;
  const next = (Array.isArray(rows) ? rows : []).map((row) => {
    if (String(row?.id || '') !== String(rowId || '')) return row;
    found = true;
    return { ...row, ...patch, id: row.id };
  });
  return { rows: next, found };
};

export const removeTransportationRow = (rows, rowId) => {
  const source = Array.isArray(rows) ? rows : [];
  const next = source.filter((row) => String(row?.id || '') !== String(rowId || ''));
  return { rows: next, found: next.length !== source.length };
};
