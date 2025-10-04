import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import User from './models/Users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(compression());

// Increase body limit to allow page preview (base64) and large canvases
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Ensure mutating responses are not cached by intermediaries
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// serve uploaded images statically with aggressive caching on CDN/browser: GET /uploads/<filename>
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
  },
}));

// роуты товаров
import productRoutes from './routes/products.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import deckRoutes from './routes/decks.js';
import pageRoutes from './routes/pages.js';
import staffRoutes from './routes/staff.js';
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/staff', staffRoutes);

// подключение к Mongo
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err));
}

// health-check
app.get('/', (req, res) => {
  res.send('Backend OK');
});

app.get('/api', (req, res) => {
  res.json({ message: 'API работает 🚀' });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// Ensure super admin exists (email/password from env, never logged)
async function ensureSuperAdmin() {
  try {
    const email = process.env.SUPERADMIN_EMAIL;
    const password = process.env.SUPERADMIN_PASSWORD;
    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    if (!email || !password) return; // skip if not configured
    const existing = await User.findOne({ email: email.toLowerCase().trim() }).select('_id');
    if (existing) return;
    const hash = await bcrypt.hash(password, 10);
    await User.create({
      username,
      email: email.toLowerCase().trim(),
      role: 'admin', // or 'super Admin' if you rely on that level
      password: hash,
    });
    console.log('✅ Super admin created:', email);
  } catch (e) {
    console.error('❌ ensureSuperAdmin failed:', e?.message || e);
  }
}

// Call once DB is ready
mongoose.connection.once('open', () => { ensureSuperAdmin(); });

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
