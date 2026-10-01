const roleOf = (auth) => String(auth?.role || '').trim().toLowerCase();

export const kitchenReportPosition = (auth, assignedShifts = []) => {
  if (String(auth?.jobTitle || '').trim().toLowerCase() === 'executive chef') return 'Executive Chef';
  return assignedShifts.find((shift) => /\b(?:lead|executive)\s+chef\b/i.test(String(shift?.position || '').replace(/[-_]+/g, ' ')))?.position || '';
};

export const canUseKitchenReport = (auth, assignedShifts = []) => roleOf(auth) === 'event staff'
  && Boolean(kitchenReportPosition(auth, assignedShifts));

export const canReadStaffInventory = (auth) => (
  ['event staff', 'captain', 'bar captain'].includes(roleOf(auth))
  && auth?.permissions?.inventoryRead === true
);

// Event Staff has no general workspace access, even through an authenticated integration URL.
export const eventStaffRequestAllowed = (auth, req) => {
  if (roleOf(auth) !== 'event staff') return true;
  const path = String(req.originalUrl || '').split('?')[0];
  const method = String(req.method || '').toUpperCase();
  // The route checks the current user's assignment before granting report access.
  if (method === 'POST'
    && /^\/api\/staff-portal\/events\/[^/]+\/kitchen-report-link\/?$/.test(path)) return true;
  if (['GET', 'HEAD'].includes(method)) {
    return /^\/api\/staff-portal\/events(?:\/[^/]+)?\/?$/.test(path)
      || (canReadStaffInventory(auth) && /^\/api\/staff-portal\/inventory\/?$/.test(path));
  }
  return ['PUT', 'PATCH'].includes(method)
    && [`/api/users/${auth.userId}/password`, `/users/${auth.userId}/password`].includes(path.replace(/\/$/, ''));
};
