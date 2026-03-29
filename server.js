import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import User from './models/Users.js';
import {
  requireAdmin,
  requireAdminForMutations,
  requireAuth,
  requireMethodGuards,
  requireProposalAccess,
} from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(__dirname, envFile) });
dotenv.config({ path: path.join(__dirname, '.env') });

if (!String(process.env.JWT_SECRET || '').trim()) {
  console.warn('JWT_SECRET is not configured. Auth endpoints will reject requests until it is set.');
}

const parseOriginList = (...values) => values
  .flatMap((value) => String(value || '').split(','))
  .map((value) => value.trim())
  .filter(Boolean);

const allowedCorsOrigins = new Set([
  ...parseOriginList(
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.CORS_ORIGINS,
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ORIGIN,
    process.env.CLIENT_URL,
    process.env.APP_URL
  ),
  ...(process.env.NODE_ENV === 'production'
    ? [
        'https://ocdecks.com',
        'https://www.ocdecks.com',
      ]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]),
]);

if (allowedCorsOrigins.size === 0) {
  console.warn('⚠️ No allowed CORS origins configured. Only same-origin and non-browser requests will work.');
}

const isAllowedCorsOrigin = (origin) => {
  const normalized = String(origin || '').trim();
  if (!normalized) return true;
  return allowedCorsOrigins.has(normalized);
};

const applyCorsHeaders = (req, res) => {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin || !isAllowedCorsOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.append('Vary', 'Origin');
  return true;
};

const corsOptions = {
  origin(origin, callback) {
    return callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
  optionsSuccessStatus: 204,
  allowedHeaders: ['Authorization', 'Content-Type'],
};

const requireAdminForPatchDelete = requireMethodGuards((req) => {
  const method = String(req.method || '').toUpperCase();
  return ['PATCH', 'PUT', 'DELETE'].includes(method) ? requireAdmin : null;
});

const requireUsersAccess = requireMethodGuards((req) => {
  const method = String(req.method || '').toUpperCase();
  return ['GET', 'HEAD'].includes(method) ? requireProposalAccess : requireAdmin;
});

const requireProposalTemplateAccess = requireMethodGuards((req) => {
  const method = String(req.method || '').toUpperCase();
  const requestPath = String(req.path || '');
  if (['GET', 'HEAD'].includes(method)) return requireProposalAccess;
  if (method === 'POST' && /\/apply\/?$/.test(requestPath)) return requireProposalAccess;
  return requireAdmin;
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use((req, res, next) => {
  const applied = applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS' && applied) {
    return res.sendStatus(204);
  }
  return next();
});
app.use(cors(corsOptions));
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

const PUBLIC_IMAGE_PROXY_HOSTS = new Set([
  'res.cloudinary.com',
  'inventory-back-y61h.onrender.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

const isAllowedPublicImageHost = (hostname) => {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  if (PUBLIC_IMAGE_PROXY_HOSTS.has(normalized)) return true;
  return normalized.endsWith('.cloudinary.com');
};

app.get('/api/image-proxy', async (req, res) => {
  const rawUrl = String(req.query?.url || '').trim();
  if (!rawUrl) {
    return res.status(400).json({ message: 'url query param is required' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ message: 'Invalid image URL' });
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return res.status(400).json({ message: 'Unsupported image protocol' });
  }

  if (!isAllowedPublicImageHost(targetUrl.hostname)) {
    return res.status(403).json({ message: 'Image host is not allowed' });
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(502).json({ message: `Upstream image request failed (${upstream.status})` });
    }

    const contentType = String(upstream.headers.get('content-type') || '').trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ message: 'Upstream resource is not an image' });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const cacheControl = String(upstream.headers.get('cache-control') || '').trim();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl || 'public, max-age=86400');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Failed to proxy image' });
  }
});

// роуты товаров
import productRoutes from './routes/products.js';
import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import deckRoutes from './routes/decks.js';
import pageRoutes from './routes/pages.js';
import staffRoutes from './routes/staff.js';
import kitchenRoutes from './routes/kitchen.js';
import beverageRoutes from './routes/beverage.js';
import clientRoutes from './routes/clients.js';
import proposalRoutes from './routes/proposals.js';
import proposalTemplateRoutes from './routes/proposalTemplates.js';
import toolsRoutes from './routes/tools.js';

app.use('/api/auth', authRoutes);
app.use('/api/products', requireAuth, requireAdminForMutations, productRoutes);
app.use('/api/users', requireAuth, requireUsersAccess, userRoutes);
app.use('/users', requireAuth, requireUsersAccess, userRoutes);
app.use('/api/events', requireAuth, eventRoutes);
app.use('/api/decks', requireAuth, deckRoutes);
app.use('/api/pages', requireAuth, pageRoutes);
app.use('/api/staff', requireAuth, requireAdminForMutations, staffRoutes);
app.use('/api/kitchen-items', requireAuth, requireAdminForMutations, kitchenRoutes);
app.use('/api/beverage-items', requireAuth, requireAdminForMutations, beverageRoutes);
app.use('/api/clients', requireAuth, requireAdminForPatchDelete, clientRoutes);
app.use('/api/proposals', requireAuth, requireProposalAccess, proposalRoutes);
app.use('/api/proposal-templates', requireAuth, requireProposalTemplateAccess, proposalTemplateRoutes);
app.use('/api/tools', requireAuth, requireAdmin, toolsRoutes);

// подключение к Mongo
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/inventory';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set');
} else {
  const mongoOptions = {};
  if (MONGO_DB_NAME) {
    mongoOptions.dbName = MONGO_DB_NAME;
  }
  mongoose.connect(MONGO_URI, mongoOptions)
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
