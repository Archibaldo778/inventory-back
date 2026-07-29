import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
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

export const resolveUsersGuard = (req) => {
  const method = String(req.method || '').toUpperCase();
  if (['GET', 'HEAD'].includes(method)) {
    return /^\/options\/?$/i.test(String(req.path || ''))
      ? requireProposalAccess
      : requireAdmin;
  }
  const passwordMatch = String(req.path || '').match(/^\/([a-f\d]{24})\/password\/?$/i);
  if (
    passwordMatch
    && String(req.auth?.userId || '').toLowerCase() === passwordMatch[1].toLowerCase()
  ) return null;
  return requireAdmin;
};

const requireUsersAccess = requireMethodGuards(resolveUsersGuard);

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

const LOCAL_IMAGE_PROXY_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);
const IMAGE_PROXY_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_PROXY_MAX_REDIRECTS = 3;
const IMAGE_PROXY_TIMEOUT_MS = 10_000;
const IMAGE_PROXY_RATE_WINDOW_MS = 60_000;
const IMAGE_PROXY_RATE_MAX = 120;
const IMAGE_PROXY_RATE_BUCKET_MAX = 10_000;
const imageProxyRateBuckets = new Map();

const isPublicIpv4 = (hostname) => {
  const parts = String(hostname || '').trim().split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
};

const isPublicIpAddress = (address) => {
  const normalized = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) {
    // Public IPv6 unicast currently lives in 2000::/3. Reject mapped and
    // special-purpose ranges instead of trying to maintain a partial denylist.
    return /^[23][0-9a-f]{0,3}:/.test(normalized);
  }
  return false;
};

const normalizeImageProxyHostname = (hostname) => (
  String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
);

const isAllowedPublicImageHost = (hostname) => {
  const normalized = normalizeImageProxyHostname(hostname);
  if (!normalized) return false;
  if (LOCAL_IMAGE_PROXY_HOSTS.has(normalized)) return false;
  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return false;
  if (net.isIP(normalized) && !isPublicIpAddress(normalized)) return false;
  return true;
};

const resolvePublicImageAddress = async (hostname) => {
  const normalized = normalizeImageProxyHostname(hostname);
  if (!isAllowedPublicImageHost(normalized)) {
    throw new Error('Image host is not allowed');
  }

  if (net.isIP(normalized)) {
    return { address: normalized, family: net.isIP(normalized) };
  }

  const addresses = await dns.lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('Image host resolved to a non-public address');
  }
  return addresses[0];
};

const validateImageProxyUrl = (value) => {
  const targetUrl = value instanceof URL ? value : new URL(String(value || ''));
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('Unsupported image protocol');
  }
  if (targetUrl.username || targetUrl.password) {
    throw new Error('Image URL credentials are not allowed');
  }
  const expectedPort = targetUrl.protocol === 'https:' ? '443' : '80';
  if (targetUrl.port && targetUrl.port !== expectedPort) {
    throw new Error('Non-standard image ports are not allowed');
  }
  if (!isAllowedPublicImageHost(targetUrl.hostname)) {
    throw new Error('Image host is not allowed');
  }
  return targetUrl;
};

const readBoundedImageResponse = (response) => new Promise((resolve, reject) => {
  const statusCode = Number(response.statusCode || 0);
  const contentType = String(response.headers['content-type'] || '').trim().toLowerCase();
  const cacheControl = String(response.headers['cache-control'] || '').trim();
  const contentLength = Number(response.headers['content-length'] || 0);

  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    reject(Object.assign(new Error(`Upstream image request failed (${statusCode})`), { statusCode: 502 }));
    return;
  }
  if (!contentType.startsWith('image/')) {
    response.resume();
    reject(Object.assign(new Error('Upstream resource is not an image'), { statusCode: 415 }));
    return;
  }
  if (Number.isFinite(contentLength) && contentLength > IMAGE_PROXY_MAX_BYTES) {
    response.resume();
    reject(Object.assign(new Error('Upstream image is too large'), { statusCode: 413 }));
    return;
  }

  const chunks = [];
  let totalBytes = 0;
  response.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > IMAGE_PROXY_MAX_BYTES) {
      response.destroy(Object.assign(new Error('Upstream image is too large'), { statusCode: 413 }));
      return;
    }
    chunks.push(chunk);
  });
  response.on('end', () => resolve({
    buffer: Buffer.concat(chunks, totalBytes),
    contentType,
    cacheControl,
  }));
  response.on('error', reject);
});

const fetchPublicImage = async (initialUrl, redirectCount = 0) => {
  const targetUrl = validateImageProxyUrl(initialUrl);
  const resolved = await resolvePublicImageAddress(targetUrl.hostname);
  const transport = targetUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(targetUrl, {
      method: 'GET',
      family: resolved.family,
      lookup: (_hostname, _options, callback) => {
        callback(null, resolved.address, resolved.family);
      },
      headers: {
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        'User-Agent': 'OCDecks-Image-Proxy/1.0',
      },
    }, async (response) => {
      const statusCode = Number(response.statusCode || 0);
      const location = String(response.headers.location || '').trim();
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= IMAGE_PROXY_MAX_REDIRECTS) {
          reject(Object.assign(new Error('Too many image redirects'), { statusCode: 502 }));
          return;
        }
        try {
          const redirectUrl = new URL(location, targetUrl);
          resolve(await fetchPublicImage(redirectUrl, redirectCount + 1));
        } catch (error) {
          reject(error);
        }
        return;
      }

      try {
        resolve(await readBoundedImageResponse(response));
      } catch (error) {
        reject(error);
      }
    });

    request.setTimeout(IMAGE_PROXY_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('Upstream image request timed out'), { statusCode: 504 }));
    });
    request.on('error', reject);
    request.end();
  });
};

const enforceImageProxyRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const current = imageProxyRateBuckets.get(key);

  if (!current && imageProxyRateBuckets.size >= IMAGE_PROXY_RATE_BUCKET_MAX) {
    for (const [bucketKey, value] of imageProxyRateBuckets) {
      if (value.resetAt <= now) imageProxyRateBuckets.delete(bucketKey);
    }
    if (imageProxyRateBuckets.size >= IMAGE_PROXY_RATE_BUCKET_MAX) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ message: 'Image proxy is temporarily busy' });
    }
  }

  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + IMAGE_PROXY_RATE_WINDOW_MS }
    : current;
  bucket.count += 1;
  imageProxyRateBuckets.set(key, bucket);

  res.setHeader('RateLimit-Limit', String(IMAGE_PROXY_RATE_MAX));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, IMAGE_PROXY_RATE_MAX - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > IMAGE_PROXY_RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many image proxy requests' });
  }
  return next();
};

app.get('/api/image-proxy', enforceImageProxyRateLimit, async (req, res) => {
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

  try {
    validateImageProxyUrl(targetUrl);
  } catch (error) {
    return res.status(403).json({ message: error instanceof Error ? error.message : 'Image URL is not allowed' });
  }

  try {
    const upstream = await fetchPublicImage(targetUrl);
    res.setHeader('Content-Type', upstream.contentType);
    res.setHeader('Cache-Control', upstream.cacheControl || 'public, max-age=86400');
    return res.status(200).send(upstream.buffer);
  } catch (error) {
    const statusCode = Number(error?.statusCode);
    const safeStatusCode = [413, 415, 502, 504].includes(statusCode) ? statusCode : 502;
    return res.status(safeStatusCode).json({
      message: error instanceof Error ? error.message : 'Failed to proxy image',
    });
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
const configuredMongoUri = String(process.env.MONGO_URI || '').trim();
const MONGO_URI = configuredMongoUri || (
  process.env.NODE_ENV === 'production' ? '' : 'mongodb://localhost:27017/inventory'
);
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;

// health-check
export const getDatabaseHealth = () => {
  const connected = mongoose.connection.readyState === 1;
  return {
    connected,
    statusCode: connected ? 200 : 503,
    database: connected ? 'connected' : 'unavailable',
  };
};

app.get('/', (req, res) => {
  const health = getDatabaseHealth();
  res.status(health.statusCode).json({
    ok: health.connected,
    database: health.database,
  });
});

app.get('/api', (req, res) => {
  const health = getDatabaseHealth();
  res.status(health.statusCode).json({
    message: health.connected ? 'API работает 🚀' : 'API unavailable',
    database: health.database,
  });
});

app.get('/api/test', (req, res) => {
  const health = getDatabaseHealth();
  res.status(health.statusCode).json({
    message: health.connected ? 'Backend is working!' : 'Backend database is unavailable',
  });
});

// Ensure super admin exists (email/password from env, never logged)
async function ensureSuperAdmin() {
  try {
    const email = process.env.SUPERADMIN_EMAIL;
    const password = process.env.SUPERADMIN_PASSWORD;
    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    if (!email || !password) return; // skip if not configured
    const existing = await User.findOne({ email: email.toLowerCase().trim() })
      .select('_id role isActive');
    if (existing) {
      const updates = {};
      if (String(existing.role || '').trim().toLowerCase() !== 'super admin') {
        updates.role = 'super admin';
      }
      if (existing.isActive === false) {
        updates.isActive = true;
      }
      if (Object.keys(updates).length > 0) {
        await User.updateOne({ _id: existing._id }, { $set: updates }, { runValidators: true });
      }
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    await User.create({
      username,
      email: email.toLowerCase().trim(),
      role: 'super admin',
      password: hash,
    });
    console.log('✅ Super admin created');
  } catch (e) {
    console.error('❌ ensureSuperAdmin failed:', e?.message || e);
  }
}

const PORT = process.env.PORT || 5050;

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: 'Route not found' });
};

app.use(notFoundHandler);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(statusCode).json({
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large' : 'Invalid file upload',
      code: error.code,
    });
  }

  if (error?.type === 'entity.too.large' || Number(error?.status) === 413) {
    return res.status(413).json({ message: 'Request body is too large' });
  }

  console.error('Unhandled request error:', error?.message || error);
  return res.status(500).json({ message: 'Internal server error' });
});

export const startServer = async () => {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required in production');
  }

  const mongoOptions = {};
  if (MONGO_DB_NAME) mongoOptions.dbName = MONGO_DB_NAME;
  await mongoose.connect(MONGO_URI, mongoOptions);
  console.log('✅ MongoDB connected');
  await ensureSuperAdmin();

  const server = app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    const forceExit = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      try {
        await mongoose.disconnect();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (error) {
        console.error('MongoDB disconnect failed:', error?.message || error);
        process.exit(1);
      }
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
};

const isMainModule = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === __filename
);

if (isMainModule) {
  startServer().catch((error) => {
    console.error('❌ Server startup failed:', error?.message || error);
    process.exit(1);
  });
}

export { app };
