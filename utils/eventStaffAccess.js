export const KITCHEN_PORTAL_ROLES = ['event staff', 'kitchen lead'];
const roleOf = (auth) => String(auth?.role || '').trim().toLowerCase();

export const kitchenReportPosition = (_auth, assignedShifts = []) => {
  return assignedShifts.find((shift) => /\b(?:(?:lead|executive)\s+chef|(?:kitchen|proofer)\s+lead)\b/i.test(String(shift?.position || '').replace(/[-_]+/g, ' ')))?.position || '';
};

export const canUseKitchenReport = (auth, assignedShifts = []) => KITCHEN_PORTAL_ROLES.includes(roleOf(auth))
  && Boolean(kitchenReportPosition(auth, assignedShifts));

export const canReadStaffInventory = (auth) => (
  ['event staff', 'captain', 'bar captain'].includes(roleOf(auth))
  && auth?.permissions?.inventoryRead === true
);

// Event Staff has no general workspace access, even through an authenticated integration URL.
export const eventStaffRequestAllowed = (auth, req) => {
  if (!KITCHEN_PORTAL_ROLES.includes(roleOf(auth))) return true;
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
