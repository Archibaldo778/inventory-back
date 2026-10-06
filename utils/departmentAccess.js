export const DEPARTMENT_ADMIN_ROLES = ['kitchen admin', 'staffing admin'];
export const ACCOUNT_ROLES = [
  'user', 'manager', 'sales rep', 'admin', 'super admin', 'bar admin',
  ...DEPARTMENT_ADMIN_ROLES,
  'captain', 'bar captain', 'bartender', 'packer', 'uniform packer', 'event staff', 'kitchen lead',
];
const roleOf = (auth) => String(auth?.role || '').trim().toLowerCase();
export const isDepartmentAdmin = (auth) => DEPARTMENT_ADMIN_ROLES.includes(roleOf(auth));
export const departmentEmployeeRoles = (auth) => roleOf(auth) === 'kitchen admin'
  ? ['kitchen lead', 'event staff']
  : roleOf(auth) === 'staffing admin' ? ['captain', 'bar captain', 'bartender', 'uniform packer'] : [];
export const invitationRolesFor = (auth) => {
  if (roleOf(auth) === 'super admin') return ACCOUNT_ROLES;
  if (roleOf(auth) === 'admin') return ACCOUNT_ROLES.filter((role) => role !== 'super admin');
  return departmentEmployeeRoles(auth);
};
export const departmentUserFilter = (auth) => isDepartmentAdmin(auth)
  ? { role: { $in: departmentEmployeeRoles(auth) } } : {};
export const canManageDepartmentUser = (auth, user) => !isDepartmentAdmin(auth)
  || departmentEmployeeRoles(auth).includes(roleOf(user));

// Department admins share operational access, but cannot administer global
// identities, integrations or financial access through an alternate API path.
export const departmentAdminRequestAllowed = (auth, req) => {
  if (!isDepartmentAdmin(auth)) return true;
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  const method = String(req.method || '').toUpperCase();
  const read = ['GET', 'HEAD'].includes(method);
  if (/^\/(?:api\/)?users(?:\/|$)/.test(path)) {
    const suffix = path.replace(/^\/(?:api\/)?users/, '');
    if (roleOf(auth) === 'staffing admin' && (suffix === '/access-requests' || suffix.startsWith('/access-requests/'))) {
      return (read && suffix === '/access-requests') || (method === 'POST' && /^\/access-requests\/[^/]+\/(?:approve|reject)$/.test(suffix));
    }
    if (read) return ['', '/invite-templates', '/options'].includes(suffix);
    if (method === 'POST') return suffix === '/invite';
    if (['PUT', 'PATCH'].includes(method)) return /^\/[a-f\d]{24}(?:\/password)?$/i.test(suffix) || suffix === '/update';
    return method === 'DELETE' && /^\/[a-f\d]{24}$/i.test(suffix);
  }
  if (/^\/api\/integrations\/(?:dropbox|slack|caterease)\/(?:connect|disconnect|settings|oauth|config|financials?)(?:[-/]|$)/.test(path)) return false;
  if (/^\/api\/automation-alerts(?:\/|$)/.test(path)) return false;
  if (path === '/api/event-reports/settings' && !read) return false;
  return true;
};

export const canSeeDepartmentFinancials = (auth, department) => (
  ['kitchen', 'staffing'].includes(department) && (['admin', 'super admin'].includes(roleOf(auth))
  || (department === 'kitchen' && roleOf(auth) === 'kitchen admin')
  || (department === 'staffing' && roleOf(auth) === 'staffing admin'))
);
