// /routes/users.js
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import User from '../models/Users.js';
import AccessRole from '../models/AccessRole.js';
import { isRoleOwner, protectedAccountChange } from '../utils/roleOwners.js';
import { permissionValue } from '../utils/accessRolePolicy.js';
import { sendApiError } from '../utils/apiErrors.js';
import { resolveUserInvitationSender } from '../utils/userInvitationSender.js';
import { userTeamProfile } from '../utils/userTeamProfile.js';
import { hasFullSalesAccess } from '../utils/salesAccess.js';
import reportTeamRoutes from './reportTeams.js';
import accessRequestRoutes from './accessRequests.js';
import { invitationRolesFor, departmentUserFilter, canManageDepartmentUser, isDepartmentAdmin, departmentEmployeeRoles } from '../utils/departmentAccess.js';
import {
  createUserInviteToken,
  INVITE_ROLES,
  canInviteUserAsRole,
  isValidInviteEmail,
  isExistingActiveInviteAccount,
  normalizeInviteCc,
  renderUserInviteEmail,
  sendUserInviteEmail,
  userInviteUrl,
} from '../utils/userInvitations.js';

const router = express.Router();
router.use('/teams', reportTeamRoutes);
router.use('/access-requests', accessRequestRoutes);

const normalizeRole = (role) => {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return 'user';
  if (raw === 'superadmin') return 'super admin';
  return raw;
};

const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
};

const resolveSeeProposals = (source) => {
  if (!source || typeof source !== 'object') return undefined;

  const candidates = [
    source?.seeProposals,
    source?.canSeeProposals,
    source?.see_proposals,
    source?.can_see_proposals,
    source?.proposalsRead,
    source?.proposalRead,
    source?.proposals_read,
    source?.proposal_read,
    source?.permissions?.seeProposals,
    source?.permissions?.proposalsRead,
    source?.permissions?.proposalRead,
    source?.permissions?.proposals,
    source?.permissions?.proposals?.read,
  ];

  for (const candidate of candidates) {
    const parsed = toBool(candidate);
    if (typeof parsed === 'boolean') return parsed;
  }

  return undefined;
};

const resolveSeeBarFinancials = (source) => {
  if (!source || typeof source !== 'object') return undefined;
  const candidates = [
    source?.seeBarFinancials,
    source?.canSeeBarFinancials,
    source?.permissions?.seeBarFinancials,
    source?.permissions?.barFinancials,
  ];
  for (const candidate of candidates) {
    const parsed = toBool(candidate);
    if (typeof parsed === 'boolean') return parsed;
  }
  return undefined;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isSuperAdminRole = (value) => normalizeRole(value) === 'super admin';
const isSuperAdminAuth = (auth) => isSuperAdminRole(auth?.role);
const canAssignUserAccess = (auth) => permissionValue(auth, 'users.assignRoles', ['admin', 'super admin', 'kitchen admin', 'staffing admin'].includes(auth?.role));

const buildPermissionsPayload = (sourcePermissions, seeProposals, seeBarFinancials) => {
  const base =
    sourcePermissions && typeof sourcePermissions === 'object' && !Array.isArray(sourcePermissions)
      ? sourcePermissions
      : {};
  return {
    ...base,
    seeProposals: Boolean(seeProposals),
    seeBarFinancials: Boolean(seeBarFinancials),
  };
};

const serializeUser = (source, auth) => {
  if (!source) return null;
  const user = typeof source.toObject === 'function' ? source.toObject() : source;
  const seeProposals = hasFullSalesAccess(user) || resolveSeeProposals(user) === true;
  const seeBarFinancials = hasFullSalesAccess(user) || resolveSeeBarFinancials(user) === true;

  return {
    id: user?._id || user?.id,
    _id: user?._id || user?.id,
    username: user?.username || '',
    name: user?.username || '',
    email: user?.email || '',
    nowstaName: user?.nowstaName || '',
    role: isSuperAdminRole(user.role) && !isSuperAdminAuth(auth) ? 'admin' : normalizeRole(user.role),
    jobTitle: user?.jobTitle || '',
    accessRoleId: user?.accessRoleId || '',
    teamId: user?.teamId ? String(user.teamId) : '',
    receivesTeamReports: user?.receivesTeamReports === true,
    seeProposals,
    canSeeProposals: seeProposals,
    see_proposals: seeProposals,
    can_see_proposals: seeProposals,
    seeBarFinancials,
    canSeeBarFinancials: seeBarFinancials,
    permissions: buildPermissionsPayload(user?.permissions, seeProposals, seeBarFinancials),
    isActive: user?.isActive !== false,
    inviteStatus: user?.inviteAcceptedAt
      ? 'accepted'
      : (user?.inviteExpiresAt && new Date(user.inviteExpiresAt).getTime() > Date.now() ? 'invited' : ''),
    inviteSentAt: user?.inviteSentAt || null,
    inviteAcceptedAt: user?.inviteAcceptedAt || null,
    createdAt: user?.createdAt,
    updatedAt: user?.updatedAt,
  };
};

const applyUserPayload = async (user, body, { allowPassword = false } = {}) => {
  const payload = body && typeof body === 'object' ? body : {};
  Object.assign(user, await userTeamProfile(payload, {
    _id: user._id, teamId: user.teamId, receivesTeamReports: user.receivesTeamReports,
  }));

  if (typeof payload.username !== 'undefined' || typeof payload.name !== 'undefined') {
    const nextUsername = String(payload.username ?? payload.name ?? '').trim();
    if (nextUsername) user.username = nextUsername;
  }

  if (typeof payload.email !== 'undefined') {
    const nextEmail = normalizeEmail(payload.email);
    if (nextEmail) user.email = nextEmail;
  }

  if (typeof payload.nowstaName !== 'undefined') {
    user.nowstaName = String(payload.nowstaName || '').trim().slice(0, 240);
  }

  if (typeof payload.role !== 'undefined') {
    const custom = String(payload.role).startsWith('custom-') ? await AccessRole.findById(payload.role).lean() : null;
    if (String(payload.role).startsWith('custom-') && !custom) throw Object.assign(new Error('Choose an existing role'), { statusCode: 400 });
    user.role = custom ? custom.baseRole : normalizeRole(payload.role);
    user.accessRoleId = custom ? custom._id : '';
    if (custom) user.jobTitle = custom.jobTitle || '';
  }

  if (payload.permissions?.inventoryRead !== undefined) {
    if (typeof payload.permissions.inventoryRead !== 'boolean') {
      throw Object.assign(new Error('Inventory viewing permission must be on or off'), { statusCode: 400 });
    }
    const rawPermissions = typeof user.permissions?.toObject === 'function' ? user.permissions.toObject() : user.permissions;
    user.permissions = { ...rawPermissions, inventoryRead: payload.permissions.inventoryRead };
  }

  if (typeof payload.isActive !== 'undefined' || typeof payload.active !== 'undefined') {
    const nextIsActive = toBool(payload.isActive ?? payload.active);
    if (typeof nextIsActive === 'boolean') user.isActive = nextIsActive;
  }

  const nextSeeProposals = resolveSeeProposals(payload);
  if (typeof nextSeeProposals === 'boolean') {
    const rawPermissions = user.permissions && typeof user.permissions.toObject === 'function'
      ? user.permissions.toObject()
      : (user.permissions || {});
    user.seeProposals = nextSeeProposals;
    user.permissions = buildPermissionsPayload(
      rawPermissions,
      nextSeeProposals,
      typeof resolveSeeBarFinancials(user) === 'boolean' ? resolveSeeBarFinancials(user) : false
    );
  }

  const nextSeeBarFinancials = resolveSeeBarFinancials(payload);
  if (typeof nextSeeBarFinancials === 'boolean') {
    const rawPermissions = user.permissions && typeof user.permissions.toObject === 'function'
      ? user.permissions.toObject()
      : (user.permissions || {});
    user.seeBarFinancials = nextSeeBarFinancials;
    user.permissions = buildPermissionsPayload(
      rawPermissions,
      typeof resolveSeeProposals(user) === 'boolean' ? resolveSeeProposals(user) : false,
      nextSeeBarFinancials
    );
  }

  if (allowPassword && typeof payload.password === 'string' && payload.password.trim()) {
    const nextPassword = payload.password.trim();
    if (nextPassword.length < 8) {
      const error = new Error('Password must be at least 8 characters');
      error.statusCode = 400;
      throw error;
    }
    user.password = await bcrypt.hash(nextPassword, 10);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  }
};

const updateAndReturn = async (id, body, auth, { allowPassword = false } = {}) => {
  const userId = String(id || '').trim();
  if (!userId) return { status: 400, payload: { message: 'id обязателен' } };

  const user = await User.findById(userId).select('+password +tokenVersion +accessAudit');
  if (!user) return { status: 404, payload: { message: 'Пользователь не найден' } };
  if (body.role !== undefined && (String(body.role).startsWith('custom-') || user.accessRoleId) && body.role !== (user.accessRoleId || user.role) && !isRoleOwner(auth)) {
    return { status: 403, payload: { message: 'Only role owners can assign custom roles' } };
  }
  const protectedError = protectedAccountChange(user, body, auth);
  if (protectedError) return { status: 403, payload: { message: protectedError } };
  const changesAccess = (body.role !== undefined && normalizeRole(body.role) !== normalizeRole(user.accessRoleId || user.role))
    || (body.jobTitle !== undefined && body.jobTitle !== (user.jobTitle || ''))
    || (resolveSeeProposals(body) !== undefined && resolveSeeProposals(body) !== (hasFullSalesAccess(user) || resolveSeeProposals(user) === true))
    || (resolveSeeBarFinancials(body) !== undefined && resolveSeeBarFinancials(body) !== (hasFullSalesAccess(user) || resolveSeeBarFinancials(user) === true))
    || (body.permissions?.inventoryRead !== undefined && body.permissions.inventoryRead !== (user.permissions?.inventoryRead === true));
  if (changesAccess && !canAssignUserAccess(auth)) return { status: 403, payload: { message: 'Your role cannot change user access' } };
  if (!canManageDepartmentUser(auth, user)) return { status: 403, payload: { message: 'You can manage only employees in your department' } };
  if (isDepartmentAdmin(auth)) {
    if (body.role !== undefined && !departmentEmployeeRoles(auth).includes(normalizeRole(body.role))) {
      return { status: 403, payload: { message: 'You cannot grant this role' } };
    }
    const allowedFields = ['id', '_id', 'userId', 'username', 'name', 'email', 'nowstaName', 'role', 'isActive', 'active', 'password'];
    if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
      return { status: 403, payload: { message: 'Only full administrators can change access permissions and team assignments' } };
    }
  }
  if (isSuperAdminRole(user.role) && !isSuperAdminAuth(auth)) {
    return { status: 403, payload: { message: 'You do not have permission to manage this account' } };
  }
  if (isSuperAdminRole(body?.role) && !isSuperAdminAuth(auth)) {
    return { status: 403, payload: { message: 'Only a super admin can grant this role' } };
  }
  if (String(body.role || '').startsWith('custom-') && !isSuperAdminAuth(auth)) {
    const proposedRole = await AccessRole.findById(body.role).lean();
    if (proposedRole?.baseRole === 'super admin') return { status: 403, payload: { message: 'Only a super admin can grant this role' } };
  }
  if (
    String(auth?.userId || '') === String(user._id)
    && isSuperAdminRole(user.role)
    && body?.role !== undefined
    && !isSuperAdminRole(body.role)
  ) {
    return { status: 400, payload: { message: 'You cannot remove your own super admin role' } };
  }
  const requestedActive = toBool(body?.isActive ?? body?.active);
  if (
    String(auth?.userId || '') === String(user._id)
    && isSuperAdminRole(user.role)
    && requestedActive === false
  ) {
    return { status: 400, payload: { message: 'You cannot deactivate your own super admin account' } };
  }

  const accessSnapshot = () => ({ role: user.role, accessRoleId: user.accessRoleId || '', jobTitle: user.jobTitle || '', seeProposals: user.seeProposals, seeBarFinancials: user.seeBarFinancials,
    inventoryRead: user.permissions?.inventoryRead });
  const beforeAccess = accessSnapshot();
  await applyUserPayload(user, body, { allowPassword });
  const afterAccess = accessSnapshot();
  if (JSON.stringify(beforeAccess) !== JSON.stringify(afterAccess)) {
    user.accessAudit ||= [];
    user.accessAudit.push({ actorId: auth.userId, at: new Date(), before: beforeAccess, after: afterAccess });
  }
  await user.save();

  const saved = await User.findById(user._id).select('-password');
  return { status: 200, payload: serializeUser(saved, auth) };
};

const handleUpdateByPathId = async (req, res) => {
  try {
    const result = await updateAndReturn(req.params.id, req.body, req.auth, { allowPassword: true });
    res.status(result.status).json(result.payload);
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Update user failed',
      fallbackMessage: 'Ошибка обновления пользователя',
    });
  }
};

const handleUpdateByBodyId = async (req, res) => {
  try {
    const id = req.body?.id || req.body?._id || req.body?.userId;
    const result = await updateAndReturn(id, req.body, req.auth, { allowPassword: true });
    res.status(result.status).json(result.payload);
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Update user by body id failed',
      fallbackMessage: 'Ошибка обновления пользователя',
    });
  }
};

// Limited directory used by proposal assignment. Never expose permissions,
// activation state, or other account-management fields here.
router.get('/options', async (req, res) => {
  try {
    const users = await User.find({
      $or: [{ role: 'sales rep' }, { jobTitle: 'sales' }],
      isActive: { $ne: false },
    })
      .select('_id username email role')
      .sort({ username: 1, email: 1 })
      .lean();
    res.json(users.map((user) => ({
      id: user._id,
      _id: user._id,
      username: user.username || '',
      name: user.username || '',
      email: user.email || '',
      role: normalizeRole(user.role),
    })));
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'User options list failed',
      fallbackMessage: 'Ошибка получения списка пользователей',
    });
  }
});

// Список пользователей (без паролей)
router.get('/', async (req, res) => {
  try {
    const users = await User.find(departmentUserFilter(req.auth)).select('-password');
    res.json(users.map((user) => serializeUser(user, req.auth)));
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Users list failed',
      fallbackMessage: 'Ошибка получения пользователей',
    });
  }
});

// Создание пользователя
router.post('/', async (req, res) => {
  try {
    if (isDepartmentAdmin(req.auth)) return res.status(403).json({ message: 'Use Send invitations to add department employees' });
    const body = req.body || {};
    const username = String(body.username ?? body.name ?? '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    let role = normalizeRole(body.role || 'user');
    if (!canAssignUserAccess(req.auth)) return res.status(403).json({ message: 'Your role cannot assign user access' });
    if (role.startsWith('custom-') && !isRoleOwner(req.auth)) return res.status(403).json({ message: 'Only role owners can assign custom roles' });
    const custom = role.startsWith('custom-') ? await AccessRole.findById(role).lean() : null;
    if (role.startsWith('custom-') && !custom) return res.status(400).json({ message: 'Choose an existing role' });
    if (custom) role = custom.baseRole;
    const isActive = toBool(body.isActive ?? body.active);

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'username, email и password обязательны' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    if (isSuperAdminRole(role) && !isSuperAdminAuth(req.auth)) {
      return res.status(403).json({ message: 'Only a super admin can grant this role' });
    }

    // Email identifies an account; multiple accounts may share a person's name.
    if (await User.findOne({ email })) {
      return res.status(409).json({ message: 'Такой email уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    const nextSeeProposals =
      typeof resolveSeeProposals(body) === 'boolean' ? resolveSeeProposals(body) : false;
    const nextSeeBarFinancials =
      typeof resolveSeeBarFinancials(body) === 'boolean' ? resolveSeeBarFinancials(body) : false;

    const teamProfile = await userTeamProfile(body);
    if (custom) teamProfile.jobTitle = custom.jobTitle || '';
    if (body.permissions?.inventoryRead !== undefined && typeof body.permissions.inventoryRead !== 'boolean') {
      return res.status(400).json({ message: 'Inventory viewing permission must be on or off' });
    }
    const user = await User.create({
      username,
      email,
      nowstaName: String(body.nowstaName || '').trim().slice(0, 240),
      role,
      accessRoleId: custom?._id || '',
      ...teamProfile,
      seeProposals: nextSeeProposals,
      seeBarFinancials: nextSeeBarFinancials,
      permissions: buildPermissionsPayload(body?.permissions, nextSeeProposals, nextSeeBarFinancials),
      accessAudit: [{ actorId: req.auth.userId, at: new Date(), before: null,
        after: { role, accessRoleId: custom?._id || '', jobTitle: teamProfile.jobTitle || '', seeProposals: nextSeeProposals, seeBarFinancials: nextSeeBarFinancials, inventoryRead: body.permissions?.inventoryRead === true } }],
      password: hash,
      isActive: typeof isActive === 'boolean' ? isActive : true,
    });

    res.status(201).json(serializeUser(user, req.auth));
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Create user failed',
      fallbackMessage: 'Ошибка при создании пользователя',
    });
  }
});

router.get('/invite-templates', (req, res) => {
  res.json(invitationRolesFor(req.auth).map((role) => ({
    role,
    ...renderUserInviteEmail({ name: '[Name]', inviteUrl: '[Personal registration link]', role, sender: req.auth }),
  })));
});

router.post('/invite', async (req, res) => {
  try {
    const body = req.body || {};
    const username = String(body.username ?? body.name ?? '').trim();
    const email = normalizeEmail(body.email);
    const nowstaName = String(body.nowstaName || username).trim().slice(0, 240);
    const inviteRole = normalizeRole(body.role || 'captain');
    if (!INVITE_ROLES.includes(inviteRole)) {
      return res.status(400).json({ message: 'Choose a valid account role' });
    }
    if (!invitationRolesFor(req.auth).includes(inviteRole)) return res.status(403).json({ message: 'You cannot invite this account role' });
    let cc;
    try { cc = normalizeInviteCc(body.cc); } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    if (!username || !email || !isValidInviteEmail(email)) {
      return res.status(400).json({ message: 'A name and valid email are required' });
    }
    let user = await User.findOne({ email }).select('+inviteTokenHash +tokenVersion +accessAudit');
    const changeRole = body.changeRole === true;
    if (user?.accessRoleId && changeRole && !isRoleOwner(req.auth)) return res.status(403).json({ message: 'Only role owners can replace custom roles' });
    if ((!user || changeRole) && !canAssignUserAccess(req.auth)) return res.status(403).json({ message: 'Your role cannot assign user access' });
    if (user && isRoleOwner(user)) return res.status(403).json({ message: 'Protected owner accounts cannot be changed through invitations' });
    if (user && (!canManageDepartmentUser(req.auth, user) || (isSuperAdminRole(user.role) && !isSuperAdminAuth(req.auth)))) {
      return res.status(403).json({ message: 'You do not have permission to manage this account' });
    }
    if (user && changeRole && String(req.auth?.userId || '') === String(user._id) && isSuperAdminRole(user.role) && !isSuperAdminRole(inviteRole)) {
      return res.status(400).json({ message: 'You cannot remove your own super admin role' });
    }
    if (user && !changeRole && !canInviteUserAsRole(normalizeRole(user.role), inviteRole)) {
      return res.status(409).json({ message: 'This email already belongs to a different account role' });
    }
    const active = isExistingActiveInviteAccount(user);
    if (!user) {
      const temporaryPassword = await bcrypt.hash(`invite-${crypto.randomUUID()}-${crypto.randomUUID()}`, 10);
      user = await User.create({ username, email, nowstaName, role: inviteRole, password: temporaryPassword, isActive: false });
    }
    const sender = resolveUserInvitationSender(req.auth);
    const invite = active ? null : createUserInviteToken();
    user.inviteSender = { name: sender.name, email: sender.email };
    if (changeRole && (normalizeRole(user.role) !== inviteRole || user.accessRoleId)) {
      user.accessAudit ||= [];
      user.accessAudit.push({ actorId: req.auth.userId, at: new Date(), before: { role: user.role, accessRoleId: user.accessRoleId || '' }, after: { role: inviteRole, accessRoleId: '' } });
      user.role = inviteRole;
      user.accessRoleId = '';
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    }
    if (invite) {
      user.isActive = false;
      user.inviteTokenHash = invite.tokenHash;
      user.inviteReminderTokenHash = '';
      user.inviteReminderAttemptedAt = null;
      user.inviteReminderSentAt = null;
      user.inviteReminderError = '';
      user.inviteSentAt = null;
      user.inviteExpiresAt = invite.expiresAt;
      user.inviteAcceptedAt = null;
    }
    await user.save();
    const inviteUrl = active ? new URL('/login', userInviteUrl('')).href : userInviteUrl(invite.token);
    const delivery = await sendUserInviteEmail({ email, name: user.username, inviteUrl, role: normalizeRole(user.role), active, cc, sender: req.auth });
    if (delivery.status !== 'sent') return res.status(502).json({ message: `Invitation was created but email failed: ${delivery.error}` });
    user.inviteSentAt = delivery.sentAt;
    await user.save();
    return res.status(201).json({ user: serializeUser(user, req.auth), delivery });
  } catch (e) {
    return sendApiError(res, e, { field: 'message', context: 'Invite user failed', fallbackMessage: 'Could not invite this user' });
  }
});

// Универсальное обновление пользователя
router.patch('/update', handleUpdateByBodyId);
router.put('/update', handleUpdateByBodyId);
router.post('/update', handleUpdateByBodyId);
router.patch('/:id', handleUpdateByPathId);
router.put('/:id', handleUpdateByPathId);
router.patch('/:id/update', handleUpdateByPathId);
router.put('/:id/update', handleUpdateByPathId);
router.post('/:id/update', handleUpdateByPathId);

// Обновление роли
router.put('/:id/role', handleUpdateByPathId);
router.patch('/:id/role', handleUpdateByPathId);

// Обновление доступа к proposals
router.put('/:id/proposals', handleUpdateByPathId);
router.patch('/:id/proposals', handleUpdateByPathId);
router.put('/:id/see-proposals', handleUpdateByPathId);
router.patch('/:id/see-proposals', handleUpdateByPathId);
router.put('/:id/see-bar-financials', handleUpdateByPathId);
router.patch('/:id/see-bar-financials', handleUpdateByPathId);

// Смена пароля
router.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: 'password обязателен' });
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const target = await User.findById(req.params.id).select('_id role');
    if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
    if (isRoleOwner(target) && !isRoleOwner(req.auth)) return res.status(403).json({ message: 'This account is protected' });
    if (String(req.auth?.userId || '') !== String(target._id) && !canManageDepartmentUser(req.auth, target)) return res.status(403).json({ message: 'You can manage only employees in your department' });
    if (isSuperAdminRole(target.role) && !isSuperAdminAuth(req.auth)) {
      return res.status(403).json({ message: 'You do not have permission to manage this account' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    await User.findByIdAndUpdate(req.params.id, {
      $set: { password: hash },
      $inc: { tokenVersion: 1 },
    }, { runValidators: true });
    res.json({ ok: true });
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Change password failed',
      fallbackMessage: 'Ошибка смены пароля',
    });
  }
});

// Удаление
router.delete('/:id', async (req, res) => {
  try {
    if (isRoleOwner({ _id: req.params.id })) return res.status(403).json({ message: 'Role owner accounts cannot be deleted' });
    if (String(req.auth?.userId || '') === String(req.params.id)) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    const target = await User.findById(req.params.id).select('_id role');
    if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!canManageDepartmentUser(req.auth, target)) return res.status(403).json({ message: 'You can manage only employees in your department' });
    if (isSuperAdminRole(target.role)) {
      if (!isSuperAdminAuth(req.auth)) {
        return res.status(403).json({ message: 'You do not have permission to manage this account' });
      }
      const superAdminCount = await User.countDocuments({
        role: { $in: ['super admin', 'super Admin'] },
      });
      if (superAdminCount <= 1) {
        return res.status(409).json({ message: 'At least one super admin must remain' });
      }
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Delete user failed',
      fallbackMessage: 'Ошибка удаления пользователя',
    });
  }
});

export default router;
