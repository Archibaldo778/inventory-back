import apicache from 'apicache';

export const shouldCacheApiResponse = (req, res) => (
  Number(res?.statusCode) === 200
  && Object.keys(req?.query || {}).length === 0
);

export const createGroupedApiCache = (duration, group) => {
  const middleware = apicache.middleware(
    duration,
    shouldCacheApiResponse,
    { statusCodes: { include: [200] } }
  );
  return (req, res, next) => {
    req.apicacheGroup = group;
    return middleware(req, res, next);
  };
};

export const clearApiCacheGroups = (...groups) => {
  for (const group of groups) {
    if (!group) continue;
    try {
      apicache.clear(group);
    } catch {
      // Cache invalidation must not make the underlying write fail.
    }
  }
};
