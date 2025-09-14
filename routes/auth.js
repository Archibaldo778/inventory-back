import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';

const router = Router();

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('rt', token, {
    httpOnly: true,
    sameSite: 'lax',
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

router.post('/login', async (req, res) => {
  try {
    const { email, username, password, remember } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ message: 'email or username and password are required' });
    }
    const q = email ? { email: String(email).toLowerCase().trim() } : { username: String(username).trim() };
    const user = await User.findOne(q).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const payload = { sub: String(user._id), role: user.role, username: user.username, email: user.email };
    const exp = remember ? '30d' : '12h';
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: exp });
    // issue refresh token with longer lifetime (90d) and set httpOnly cookie
    const rt = jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: remember ? '90d' : '30d' });
    setRefreshCookie(res, rt);
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Login error' });
  }
});

// Refresh access token using refresh cookie
router.post('/refresh', async (req, res) => {
  try {
    const rt = readCookie(req, 'rt');
    if (!rt) return res.status(401).json({ message: 'No refresh token' });
    const data = jwt.verify(rt, process.env.JWT_SECRET || 'dev_secret');
    const payload = { sub: data.sub, role: data.role, username: data.username, email: data.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '12h' });
    res.json({ token, user: { id: data.sub, username: data.username, email: data.email, role: data.role } });
  } catch (e) {
    res.status(401).json({ message: 'Invalid refresh' });
  }
});

router.post('/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('rt', { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/api/auth' });
  res.json({ ok: true });
});

export default router;
