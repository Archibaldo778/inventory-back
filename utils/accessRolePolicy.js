import AccessRole from '../models/AccessRole.js';
import { BUILTIN_ROLES, roleKeyForUser } from './accessRoleCatalog.js';
import { isRoleOwner } from './roleOwners.js';

export const permissionValue = (auth, key, fallback = false) => {
  if (isRoleOwner(auth)) return true;
  const value = auth?.accessPermissions?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

export const loadAccessRole = async (user) => {
  const key = roleKeyForUser(user);
  const saved = await AccessRole.findById(key).select('-audit').lean();
  const role = saved || BUILTIN_ROLES.find((entry) => entry._id === key);
  if (!role) throw Object.assign(new Error('Account role is unavailable'), { statusCode: 403 });
  return { roleKey: key, baseRole: role.baseRole, accessPermissions: role.permissions || {}, canManageRoles: isRoleOwner(user) };
};

export const ACCESS_RESOURCES = {
  events: 'events', decks: 'events', pages: 'events', 'nowsta-schedule': 'events',
  products: 'inventory', tools: 'inventory', 'decor-packouts': 'packouts',
  'kitchen-items': 'kitchen', 'kitchen-prep': 'kitchen', staff: 'staff',
  'uniform-items': 'uniforms', 'uniform-sets': 'uniforms', 'uniform-packing': 'uniforms',
  bar: 'bar', 'beverage-items': 'bar', 'cocktail-recipes': 'bar', clients: 'clients',
  proposals: 'proposals', 'proposal-templates': 'proposals', 'event-reports': 'reports',
  venues: 'venues', users: 'users', 'role-options': 'users', operations: 'operations', transportation: 'operations',
  integrations: 'integrations', 'automation-alerts': 'automation',
};

// Classification is shared by all authenticated route mounts. Existing object
// ownership and assigned-event guards still apply after section authorization.
export const requestAccessKeys = (req, auth = req.auth) => {
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  const parts = path.replace(/^\/(?:api\/)?/, '').split('/');
  const action = ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase()) ? 'view' : 'edit';
  if (parts[0] === 'event-report-templates') {
    const section = parts[1] === 'kitchen' ? 'kitchenTemplate' : 'captainTemplate';
    return action === 'view' ? [`${section}.view`] : [`${section}.view`, `${section}.edit`];
  }
  const staffRole = ['captain', 'bar captain', 'event staff', 'kitchen lead'].includes(auth?.role);
  const section = parts[0] === 'staff-portal' ? (parts[1] === 'inventory' ? 'inventory' : 'myEvents')
    : parts[0] === 'bar' && staffRole && parts[1]?.startsWith('events') ? 'myEvents' : ACCESS_RESOURCES[parts[0]];
  if (!section) return [];
  const keys = action === 'view' ? [`${section}.view`] : [`${section}.view`, `${section}.edit`];
  if (action === 'edit' && parts[0] === 'users' && /\/(?:invite|approve)(?:\/|$)/.test(path)) keys.push('users.invite');
  if (action === 'edit' && parts[0] === 'users' && /\/approve(?:\/|$)/.test(path)) keys.push('users.assignRoles');
  if (action === 'edit' && /\/(?:send|requests?|remind|rerun|email)(?:[-/]|$)/.test(path) && ['event-reports', 'integrations', 'bar'].includes(parts[0])) keys.push('reports.send');
  if (action === 'edit' && /\/(?:sync|import)(?:[-/]|$)/.test(path)) keys.push('integrations.sync');
  return keys;
};

export const requestPermission = (auth, req) => {
  if (isRoleOwner(auth)) return true;
  if (/^\/api\/assistant(?:\/|$)/i.test(String(req.originalUrl || '')) && Object.values(auth?.accessPermissions || {}).some((value) => value === false)) return false;
  const keys = requestAccessKeys(req, auth);
  if (!keys.length) return undefined;
  if (keys.some((key) => auth?.accessPermissions?.[key] === false)) return false;
  return keys.every((key) => auth?.accessPermissions?.[key] === true) ? true : undefined;
};
