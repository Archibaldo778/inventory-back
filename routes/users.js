// /routes/users.js
import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = express.Router();

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

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isSuperAdminRole = (value) => normalizeRole(value) === 'super admin';
const isSuperAdminAuth = (auth) => isSuperAdminRole(auth?.role);

const buildPermissionsPayload = (sourcePermissions, seeProposals) => {
  const base =
    sourcePermissions && typeof sourcePermissions === 'object' && !Array.isArray(sourcePermissions)
      ? sourcePermissions
      : {};
  return {
    ...base,
    seeProposals: Boolean(seeProposals),
  };
};

const serializeUser = (source) => {
  if (!source) return null;
  const user = typeof source.toObject === 'function' ? source.toObject() : source;
  const seeProposals =
    typeof resolveSeeProposals(user) === 'boolean' ? resolveSeeProposals(user) : false;

  return {
    id: user?._id || user?.id,
    _id: user?._id || user?.id,
    username: user?.username || '',
    name: user?.username || '',
    email: user?.email || '',
    role: normalizeRole(user?.role || 'user'),
    seeProposals,
    canSeeProposals: seeProposals,
    see_proposals: seeProposals,
    can_see_proposals: seeProposals,
    permissions: buildPermissionsPayload(user?.permissions, seeProposals),
    isActive: user?.isActive !== false,
    createdAt: user?.createdAt,
    updatedAt: user?.updatedAt,
  };
};

const applyUserPayload = async (user, body, { allowPassword = false } = {}) => {
  const payload = body && typeof body === 'object' ? body : {};

  if (typeof payload.username !== 'undefined' || typeof payload.name !== 'undefined') {
    const nextUsername = String(payload.username ?? payload.name ?? '').trim();
    if (nextUsername) user.username = nextUsername;
  }

  if (typeof payload.email !== 'undefined') {
    const nextEmail = normalizeEmail(payload.email);
    if (nextEmail) user.email = nextEmail;
  }

  if (typeof payload.role !== 'undefined') {
    user.role = normalizeRole(payload.role);
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
    user.permissions = buildPermissionsPayload(rawPermissions, nextSeeProposals);
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

  const user = await User.findById(userId).select('+password +tokenVersion');
  if (!user) return { status: 404, payload: { message: 'Пользователь не найден' } };
  if (isSuperAdminRole(user.role) && !isSuperAdminAuth(auth)) {
    return { status: 403, payload: { message: 'Only a super admin can modify this account' } };
  }
  if (isSuperAdminRole(body?.role) && !isSuperAdminAuth(auth)) {
    return { status: 403, payload: { message: 'Only a super admin can grant this role' } };
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

  await applyUserPayload(user, body, { allowPassword });
  await user.save();

  const saved = await User.findById(user._id).select('-password');
  return { status: 200, payload: serializeUser(saved) };
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
      role: 'sales rep',
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
    const users = await User.find().select('-password');
    res.json(users.map((user) => serializeUser(user)));
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
    const body = req.body || {};
    const username = String(body.username ?? body.name ?? '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const role = normalizeRole(body.role || 'user');
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

    // Явные проверки уникальности, чтобы не сыпать 500
    if (await User.findOne({ username })) {
      return res.status(409).json({ message: 'Такой username уже существует' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ message: 'Такой email уже существует' });
    }

    const hash = await bcrypt.hash(password, 10);
    const nextSeeProposals =
      typeof resolveSeeProposals(body) === 'boolean' ? resolveSeeProposals(body) : false;

    const user = await User.create({
      username,
      email,
      role,
      seeProposals: nextSeeProposals,
      permissions: buildPermissionsPayload(body?.permissions, nextSeeProposals),
      password: hash,
      isActive: typeof isActive === 'boolean' ? isActive : true,
    });

    res.status(201).json(serializeUser(user));
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Create user failed',
      fallbackMessage: 'Ошибка при создании пользователя',
    });
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
    if (isSuperAdminRole(target.role) && !isSuperAdminAuth(req.auth)) {
      return res.status(403).json({ message: 'Only a super admin can reset this password' });
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
    if (String(req.auth?.userId || '') === String(req.params.id)) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    const target = await User.findById(req.params.id).select('_id role');
    if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
    if (isSuperAdminRole(target.role)) {
      if (!isSuperAdminAuth(req.auth)) {
        return res.status(403).json({ message: 'Only a super admin can delete this account' });
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
