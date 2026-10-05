const key = (value) => String(value || '').trim().toLowerCase();
export const hasFullSalesAccess = (user) => {
  const role = key(user?.role);
  return role === 'sales rep' || (['user', 'manager', 'admin'].includes(role)
    && ['sales', 'assistant', 'team manager'].includes(key(user?.jobTitle)));
};
export const effectiveAccessRole = (user) => hasFullSalesAccess(user) ? 'admin' : key(user?.role);
