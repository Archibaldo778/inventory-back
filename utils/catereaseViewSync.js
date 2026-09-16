const DEFAULT_COOLDOWN_MS = 60_000;

export const isRecentCatereaseSync = (syncedAt, {
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) => {
  const timestamp = new Date(syncedAt || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 && (Number(now) - timestamp) < cooldownMs;
};

export const createCatereaseViewSyncDeduper = () => {
  const pending = new Map();
  return (key, task) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return Promise.resolve().then(task);
    if (pending.has(normalizedKey)) return pending.get(normalizedKey);
    const promise = Promise.resolve()
      .then(task)
      .finally(() => pending.delete(normalizedKey));
    pending.set(normalizedKey, promise);
    return promise;
  };
};

export { DEFAULT_COOLDOWN_MS as CATEREASE_VIEW_SYNC_COOLDOWN_MS };
