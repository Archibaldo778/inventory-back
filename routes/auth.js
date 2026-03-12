import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { getJwtSecret } from '../middleware/auth.js';

const router = Router();

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('rt', token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/api/auth',
    // maxAge will be embedded in token; still set a cap here if needed
  });
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === name) return decodeURIComponent(v || '');
  }
  return '';
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function resolveSeeProposals(source) {
  if (!source || typeof source !== 'object') return false;
  const candidates = [
    source?.seeProposals,
    source?.canSeeProposals,
    source?.see_proposals,
    source?.can_see_proposals,
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
  return false;
}

function buildUserResponse(source) {
  const user = typeof source?.toObject === 'function' ? source.toObject() : (source || {});
  const seeProposals = resolveSeeProposals(user);
  return {
    id: String(user?._id || user?.id || ''),
    username: user?.username || '',
    email: user?.email || '',
    role: String(user?.role || '').trim().toLowerCase(),
    seeProposals,
    permissions: {
      ...(user?.permissions && typeof user.permissions === 'object' ? user.permissions : {}),
      seeProposals,
    },
  };
}

function buildTokenPayload(source) {
  const user = buildUserResponse(source);
  return {
    sub: user.id,
    role: user.role,
    username: user.username,
    email: user.email,
    seeProposals: user.seeProposals,
  };
}

router.post('/login', async (req, res) => {
  try {
    const { email, username, password, remember } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ message: 'email or username and password are required' });
    }
    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).trim() };
    const user = await User.findOne(query).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.isActive === false) return res.status(403).json({ message: 'User account is inactive' });

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const payload = buildTokenPayload(user);
    const jwtSecret = getJwtSecret();
    const exp = remember ? '30d' : '12h';
    const token = jwt.sign(payload, jwtSecret, { expiresIn: exp });

    // issue refresh token with longer lifetime (90d) and set httpOnly cookie
    const refreshToken = jwt.sign(payload, jwtSecret, { expiresIn: remember ? '90d' : '30d' });
    setRefreshCookie(res, refreshToken);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ token, user: buildUserResponse(user) });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Login error' });
  }
});

// Refresh access token using refresh cookie
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = readCookie(req, 'rt');
    if (!refreshToken) return res.status(401).json({ message: 'No refresh token' });

    const jwtSecret = getJwtSecret();
    const data = jwt.verify(refreshToken, jwtSecret);

    const user = await User.findById(data?.sub).select('_id username email role seeProposals permissions isActive');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (user.isActive === false) return res.status(403).json({ message: 'User account is inactive' });

    const payload = buildTokenPayload(user);
    const token = jwt.sign(payload, jwtSecret, { expiresIn: '12h' });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ token, user: buildUserResponse(user) });
  } catch (e) {
    res.status(401).json({ message: 'Invalid refresh' });
  }
});

router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('rt', {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/api/auth',
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

export default router;
