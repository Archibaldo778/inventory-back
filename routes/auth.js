import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import { getJwtSecret } from '../middleware/auth.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_REMEMBERED = '90d';
const REFRESH_TOKEN_TTL_DEFAULT = '30d';
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX = 10;
const LOGIN_RATE_BUCKET_MAX = 10_000;
const loginRateBuckets = new Map();

function setRefreshCookie(res, token, remember = false) {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = (remember ? 90 : 30) * 24 * 60 * 60 * 1000;
  res.cookie('rt', token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/api/auth',
    maxAge,
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
    isActive: user?.isActive !== false,
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
    tokenVersion: Number(source?.tokenVersion || 0),
  };
}

function getLoginRateKey(req) {
  const body = req.body || {};
  const identity = String(body.email || body.username || 'unknown').trim().toLowerCase();
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  return `${ip}:${identity}`;
}

function enforceLoginRateLimit(req, res, next) {
  const now = Date.now();
  const key = getLoginRateKey(req);
  const current = loginRateBuckets.get(key);

  if (!current && loginRateBuckets.size >= LOGIN_RATE_BUCKET_MAX) {
    for (const [bucketKey, bucket] of loginRateBuckets) {
      if (bucket.resetAt <= now) loginRateBuckets.delete(bucketKey);
    }
    if (loginRateBuckets.size >= LOGIN_RATE_BUCKET_MAX) {
      res.setHeader('Retry-After', String(Math.ceil(LOGIN_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ message: 'Too many login attempts' });
    }
  }

  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + LOGIN_RATE_WINDOW_MS }
    : current;
  bucket.count += 1;
  loginRateBuckets.set(key, bucket);
  req.loginRateKey = key;

  res.setHeader('RateLimit-Limit', String(LOGIN_RATE_MAX));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, LOGIN_RATE_MAX - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > LOGIN_RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many login attempts' });
  }
  return next();
}

router.post('/login', enforceLoginRateLimit, async (req, res) => {
  try {
    const { email, username, password, remember } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ message: 'email or username and password are required' });
    }
    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).trim() };
    const user = await User.findOne(query).select('+password +tokenVersion');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.isActive === false) return res.status(403).json({ message: 'User account is inactive' });

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const payload = buildTokenPayload(user);
    const jwtSecret = getJwtSecret();
    const token = jwt.sign({ ...payload, tokenType: 'access' }, jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const isRemembered = toBool(remember) === true;
    const refreshToken = jwt.sign(
      { ...payload, tokenType: 'refresh', remember: isRemembered },
      jwtSecret,
      { expiresIn: isRemembered ? REFRESH_TOKEN_TTL_REMEMBERED : REFRESH_TOKEN_TTL_DEFAULT }
    );
    setRefreshCookie(res, refreshToken, isRemembered);
    if (req.loginRateKey) loginRateBuckets.delete(req.loginRateKey);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ token, user: buildUserResponse(user) });
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Login failed',
      fallbackMessage: 'Login service unavailable',
    });
  }
});

// Refresh access token using refresh cookie
router.post('/refresh', async (req, res) => {
  const refreshToken = readCookie(req, 'rt');
  if (!refreshToken) return res.status(401).json({ message: 'No refresh token' });

  let jwtSecret;
  try {
    jwtSecret = getJwtSecret();
  } catch (error) {
    return sendApiError(res, error, {
      field: 'message',
      context: 'Refresh configuration failed',
      defaultStatus: 503,
      fallbackMessage: 'Authentication service unavailable',
    });
  }

  let data;
  try {
    data = jwt.verify(refreshToken, jwtSecret);
    if (data?.tokenType && data.tokenType !== 'refresh') {
      return res.status(401).json({ message: 'Invalid refresh token type' });
    }
  } catch {
    return res.status(401).json({ message: 'Invalid refresh' });
  }

  try {
    const user = await User.findById(data?.sub)
      .select('_id username email role seeProposals permissions isActive +tokenVersion');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (user.isActive === false) return res.status(403).json({ message: 'User account is inactive' });
    if (Number(data?.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Session has been revoked' });
    }

    const payload = buildTokenPayload(user);
    const token = jwt.sign({ ...payload, tokenType: 'access' }, jwtSecret, {
      expiresIn: ACCESS_TOKEN_TTL,
    });
    const isRemembered = data?.remember === true;
    const nextRefreshToken = jwt.sign(
      { ...payload, tokenType: 'refresh', remember: isRemembered },
      jwtSecret,
      { expiresIn: isRemembered ? REFRESH_TOKEN_TTL_REMEMBERED : REFRESH_TOKEN_TTL_DEFAULT }
    );
    setRefreshCookie(res, nextRefreshToken, isRemembered);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ token, user: buildUserResponse(user) });
  } catch (e) {
    return sendApiError(res, e, {
      field: 'message',
      context: 'Refresh failed',
      fallbackMessage: 'Authentication service unavailable',
    });
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
