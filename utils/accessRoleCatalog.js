import { ACCOUNT_ROLES } from './departmentAccess.js';

export const ACCESS_SECTIONS = [
  ['myEvents', 'My Events and staff reports'],
  ['events', 'Events and boards'], ['inventory', 'Decor inventory'],
  ['packouts', 'Decor packouts'], ['kitchen', 'Kitchen inventory and prep'], ['staff', 'Staff catalog'],
  ['uniforms', 'Uniforms'], ['bar', 'Bar operations'], ['clients', 'Clients'],
  ['proposals', 'Proposals'], ['reports', 'Event reports'], ['venues', 'Venue history'],
  ['captainTemplate', 'Captain’s Report template'], ['kitchenTemplate', 'Kitchen Report template'],
  ['users', 'User Administration'], ['operations', 'Operations and transportation'],
  ['integrations', 'Integrations'], ['automation', 'Automated alerts'],
].map(([key, name]) => ({ key, name, actions: ['view', 'edit'] }));

export const ACCESS_SPECIALS = [
  ['bar.financials', 'View bar financials'],
  ['reports.send', 'Send report requests and emails'],
  ['users.invite', 'Send invitations'],
  ['users.assignRoles', 'Assign user roles and individual access'],
  ['integrations.sync', 'Run synchronization and imports'],
];
export const ACCESS_KEYS = new Set([
  ...ACCESS_SECTIONS.flatMap(({ key, actions }) => actions.map((action) => `${key}.${action}`)),
  ...ACCESS_SPECIALS.map(([key]) => key),
]);

export const roleKeyForUser = (user) => {
  if (user?.accessRoleId) return String(user.accessRoleId);
  const role = String(user?.role || 'user').trim().toLowerCase();
  if (role === 'superadmin') return 'super admin';
  if (role === 'sales rep') return 'sales';
  if (['user', 'manager', 'admin'].includes(role) && ['sales', 'assistant', 'team manager'].includes(user?.jobTitle)) return user.jobTitle;
  if (role !== 'super admin' && user?.jobTitle === 'executive chef') return 'executive chef';
  return role;
};

const names = { sales: 'Sales', assistant: 'Sales Assistant', 'team manager': 'Team Manager', 'executive chef': 'Executive Chef' };
export const BUILTIN_ROLES = [...ACCOUNT_ROLES.filter((role) => role !== 'sales rep'), ...Object.keys(names)]
  .map((key) => ({ _id: key, name: names[key] || key.replace(/\b\w/g, (c) => c.toUpperCase()),
    jobTitle: Object.hasOwn(names, key) ? key : '',
    baseRole: ['sales', 'assistant', 'team manager'].includes(key) ? 'admin' : key === 'executive chef' ? 'kitchen lead' : key,
    permissions: {}, revision: 0, builtin: true }));

export const roleDefaults = (role) => {
  const base = role.baseRole;
  const full = ['admin', 'super admin'].includes(base);
  const department = ['kitchen admin', 'staffing admin'].includes(base);
  const workspace = full || department || ['user', 'manager', 'bar admin', 'packer', 'uniform packer'].includes(base);
  const result = {};
  for (const { key } of ACCESS_SECTIONS) {
    const workspaceSection = ['events', 'inventory', 'packouts', 'kitchen', 'staff', 'uniforms', 'clients', 'operations'].includes(key);
    result[`${key}.view`] = full || department || (workspaceSection && workspace) || (key === 'bar' && ['bar admin', 'captain', 'bar captain', 'bartender'].includes(base));
    result[`${key}.edit`] = full || department || (['events', 'packouts'].includes(key) && ['user', 'manager', 'bar admin'].includes(base))
      || (key === 'inventory' && base === 'packer') || (key === 'bar' && base === 'bar admin');
  }
  result['captainTemplate.edit'] = full || base === 'staffing admin';
  result['myEvents.view'] = result['myEvents.edit'] = ['captain', 'bar captain', 'event staff', 'kitchen lead'].includes(base);
  result['kitchenTemplate.edit'] = full || base === 'kitchen admin';
  result['bar.financials'] = base === 'super admin' || ['sales', 'assistant', 'team manager'].includes(role.jobTitle || role._id);
  result['reports.send'] = full || department;
  result['users.invite'] = full || department;
  result['users.assignRoles'] = full || department;
  result['integrations.sync'] = full || department;
  if (department) result['automation.view'] = result['automation.edit'] = false;
  return result;
};

export const validateRoleChanges = (body) => {
  const name = String(body?.name || '').trim();
  if (!name || name.length > 80) throw Object.assign(new Error('Enter a role name (up to 80 characters)'), { statusCode: 400 });
  const permissions = body?.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)
    || Object.entries(permissions).some(([key, value]) => !ACCESS_KEYS.has(key) || typeof value !== 'boolean')) {
    throw Object.assign(new Error('Choose valid permissions'), { statusCode: 400 });
  }
  for (const { key } of ACCESS_SECTIONS) {
    if (permissions[`${key}.edit`] === true && permissions[`${key}.view`] === false) {
      throw Object.assign(new Error('Editing requires viewing access'), { statusCode: 400 });
    }
  }
  return { name, permissions: { ...permissions } };
};
