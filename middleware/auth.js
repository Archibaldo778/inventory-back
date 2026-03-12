import jwt from 'jsonwebtoken';

export const ADMIN_ROLES = Object.freeze(['admin', 'super admin']);

const ADMIN_ROLE_SET = new Set(ADMIN_ROLES);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const normalizeRole = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'superadmin') return 'super admin';
  if (raw === 'super admin') return 'super admin';
  return raw;
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
};

export const resolveSeeProposals = (source) => {
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
    const parsed = parseBoolean(candidate);
    if (typeof parsed === 'boolean') return parsed;
  }
  return false;
};

export const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return secret;
};

const getRequestToken = (req) => {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }

  const fallbackHeader = String(
    req.headers?.['x-access-token']
    || req.headers?.['x-auth-token']
    || ''
  ).trim();
  return fallbackHeader;
};

const buildAuthContext = (payload) => {
  const seeProposals = resolveSeeProposals(payload);
  return {
    userId: String(payload?.sub || payload?.userId || payload?.id || '').trim(),
    username: String(payload?.username || '').trim(),
    email: String(payload?.email || '').trim().toLowerCase(),
    role: normalizeRole(payload?.role),
    seeProposals,
    permissions: {
      ...(payload?.permissions && typeof payload.permissions === 'object' ? payload.permissions : {}),
      seeProposals,
    },
    tokenPayload: payload,
  };
};

export const isAdminAuth = (auth) => ADMIN_ROLE_SET.has(normalizeRole(auth?.role));

export const canAccessProposals = (auth) => isAdminAuth(auth) || resolveSeeProposals(auth);

export const requireAuth = (req, res, next) => {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const auth = buildAuthContext(payload);
    req.auth = auth;
    req.user = auth;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const createAccessGuard = (predicate, message) => (req, res, next) => {
  if (!req.auth) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  if (!predicate(req.auth, req)) {
    return res.status(403).json({ message });
  }
  return next();
};

export const requireRoles = (roles = []) => {
  const allowed = new Set(
    (Array.isArray(roles) ? roles : [roles])
      .map((role) => normalizeRole(role))
      .filter(Boolean)
  );

  return createAccessGuard(
    (auth) => allowed.has(normalizeRole(auth?.role)),
    'Insufficient role'
  );
};

export const requireAdmin = createAccessGuard(
  (auth) => isAdminAuth(auth),
  'Admin access required'
);

export const requireProposalAccess = createAccessGuard(
  (auth) => canAccessProposals(auth),
  'Proposal access required'
);

export const requireMethodGuards = (resolver) => (req, res, next) => {
  const guard = typeof resolver === 'function' ? resolver(req) : null;
  if (!guard) return next();
  return guard(req, res, next);
};

export const requireGuardForMutations = (guard) => requireMethodGuards((req) => {
  const method = String(req.method || '').toUpperCase();
  return SAFE_METHODS.has(method) ? null : guard;
});

export const requireAdminForMutations = requireGuardForMutations(requireAdmin);
