// /routes/users.js
import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/Users.js';

const router = express.Router();

// Список пользователей (без паролей)
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (e) {
    console.error('Users list error:', e);
    res.status(500).json({ message: 'Ошибка получения пользователей' });
  }
});

// Создание пользователя
router.post('/', async (req, res) => {
  try {
    const { username, email, role, password } = req.body;
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

    const user = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      role: role || 'User',
      password: hash, // важное: сохраняем в поле "password"
    });

    res.status(201).json({
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
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

// Смена роли
router.put('/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');
    res.json(updated);
  } catch (e) {
    console.error('Update role error:', e);
    res.status(500).json({ message: 'Ошибка обновления роли' });
  }
});

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