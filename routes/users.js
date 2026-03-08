// /routes/users.js
import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';

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

  const nextSeeProposals = resolveSeeProposals(payload);
  if (typeof nextSeeProposals === 'boolean') {
    const rawPermissions = user.permissions && typeof user.permissions.toObject === 'function'
      ? user.permissions.toObject()
      : (user.permissions || {});
    user.seeProposals = nextSeeProposals;
    user.permissions = buildPermissionsPayload(rawPermissions, nextSeeProposals);
  }

  if (allowPassword && typeof payload.password === 'string' && payload.password.trim()) {
    user.password = await bcrypt.hash(payload.password.trim(), 10);
  }
};

const updateAndReturn = async (id, body, { allowPassword = false } = {}) => {
  const userId = String(id || '').trim();
  if (!userId) return { status: 400, payload: { message: 'id обязателен' } };

  const user = await User.findById(userId).select('+password');
  if (!user) return { status: 404, payload: { message: 'Пользователь не найден' } };

  await applyUserPayload(user, body, { allowPassword });
  await user.save();

  const saved = await User.findById(user._id).select('-password');
  return { status: 200, payload: serializeUser(saved) };
};

const handleUpdateByPathId = async (req, res) => {
  try {
    const result = await updateAndReturn(req.params.id, req.body, { allowPassword: true });
    res.status(result.status).json(result.payload);
  } catch (e) {
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] || 'поле';
      return res.status(409).json({ message: `Значение для ${field} уже используется` });
    }
    if (e?.name === 'ValidationError') {
      return res.status(400).json({ message: e.message });
    }
    console.error('Update user error:', e);
    res.status(500).json({ message: 'Ошибка обновления пользователя' });
  }
};

const handleUpdateByBodyId = async (req, res) => {
  try {
    const id = req.body?.id || req.body?._id || req.body?.userId;
    const result = await updateAndReturn(id, req.body, { allowPassword: true });
    res.status(result.status).json(result.payload);
  } catch (e) {
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] || 'поле';
      return res.status(409).json({ message: `Значение для ${field} уже используется` });
    }
    if (e?.name === 'ValidationError') {
      return res.status(400).json({ message: e.message });
    }
    console.error('Update user by body id error:', e);
    res.status(500).json({ message: 'Ошибка обновления пользователя' });
  }
};

// Список пользователей (без паролей)
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users.map((user) => serializeUser(user)));
  } catch (e) {
    console.error('Users list error:', e);
    res.status(500).json({ message: 'Ошибка получения пользователей' });
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

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'username, email и password обязательны' });
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
    });

    res.status(201).json(serializeUser(user));
  } catch (e) {
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] || 'поле';
      return res.status(409).json({ message: `Значение для ${field} уже используется` });
    }
    if (e?.name === 'ValidationError') {
      return res.status(400).json({ message: e.message });
    }
    console.error('Create user error:', e);
    res.status(500).json({ message: 'Ошибка при создании пользователя' });
  }
});

// Универсальное обновление пользователя
router.patch('/:id', handleUpdateByPathId);
router.put('/:id', handleUpdateByPathId);
router.patch('/:id/update', handleUpdateByPathId);
router.put('/:id/update', handleUpdateByPathId);
router.post('/:id/update', handleUpdateByPathId);
router.patch('/update', handleUpdateByBodyId);
router.put('/update', handleUpdateByBodyId);
router.post('/update', handleUpdateByBodyId);

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
    const hash = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(req.params.id, { password: hash });
    res.json({ ok: true });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ message: 'Ошибка смены пароля' });
  }
});

// Удаление
router.delete('/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete user error:', e);
    res.status(500).json({ message: 'Ошибка удаления пользователя' });
  }
});

export default router;
