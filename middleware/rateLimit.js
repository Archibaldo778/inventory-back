const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_BUCKET_LIMIT = 10_000;

const cleanKeyPart = (value, fallback = 'unknown') => {
  const normalized = String(value || '').trim().slice(0, 160);
  return normalized || fallback;
};

export const authenticatedActorRateKey = (req) => {
  const userId = cleanKeyPart(req.auth?.userId, 'anonymous');
  const ip = cleanKeyPart(req.ip || req.socket?.remoteAddress, 'unknown');
  return `${userId}:${ip}`;
};

export const createMemoryRateLimiter = ({
  windowMs,
  max,
  message = 'Too many requests. Wait a few minutes and try again.',
  keyGenerator = authenticatedActorRateKey,
  skipSafeMethods = false,
  bucketLimit = DEFAULT_BUCKET_LIMIT,
} = {}) => {
  const duration = Math.max(1_000, Number(windowMs) || 60_000);
  const maximum = Math.max(1, Math.floor(Number(max) || 1));
  const maximumBuckets = Math.max(100, Math.floor(Number(bucketLimit) || DEFAULT_BUCKET_LIMIT));
  const buckets = new Map();

  const middleware = (req, res, next) => {
    if (skipSafeMethods && SAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();

    const now = Date.now();
    const key = cleanKeyPart(keyGenerator(req));
    let bucket = buckets.get(key);
    if (!bucket && buckets.size >= maximumBuckets) {
      for (const [bucketKey, candidate] of buckets) {
        if (candidate.resetAt <= now) buckets.delete(bucketKey);
      }
      if (buckets.size >= maximumBuckets) {
        res.setHeader('Retry-After', String(Math.ceil(duration / 1000)));
        return res.status(429).json({ message });
      }
    }

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + duration };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader('RateLimit-Limit', String(maximum));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maximum - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > maximum) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ message });
    }
    return next();
  };

  middleware.clear = () => buckets.clear();
  return middleware;
};
