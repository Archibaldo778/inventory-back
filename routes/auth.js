import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ message: 'email or username and password are required' });
    }
    const q = email ? { email: String(email).toLowerCase().trim() } : { username: String(username).trim() };
    const user = await User.findOne(q).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const payload = { sub: String(user._id), role: user.role, username: user.username, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '12h' });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Login error' });
  }
});

export default router;

