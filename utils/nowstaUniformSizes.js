import { createNowstaClient } from './nowstaApi.js';
import { nowstaClothingSizes } from './uniformRequirements.js';
import { SIZE_FIELDS, uniformSizeValue } from './uniformPacking.js';

// Cache only reads. Staff records and saved packing quantities are never changed here.
export const createNowstaSizeReader = ({
  clientFactory = () => createNowstaClient({ timeoutMs: 5_000, rateLimitRetries: 0 }),
  now = Date.now, ttlMs = 5 * 60_000, maxEntries = 1000,
} = {}) => {
  const cache = new Map();
  return async (companyUserId) => {
    const id = String(companyUserId || '').trim();
    if (!id) return {};
    const existing = cache.get(id);
    if (existing && existing.expiresAt > now()) return existing.promise;
    for (const [key, value] of cache) if (value.expiresAt <= now()) cache.delete(key);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    const record = { expiresAt: now() + ttlMs };
    record.promise = Promise.resolve().then(async () => {
      const rows = await clientFactory().listAll(`/v2/company_users/${encodeURIComponent(id)}/clothing_sizes`);
      return nowstaClothingSizes({ clothing_sizes: rows.filter((row) => String(row.company_user_id) === id) });
    }).catch((error) => { if (cache.get(id) === record) cache.delete(id); throw error; });
    cache.set(id, record);
    return record.promise;
  };
};

const readSizes = createNowstaSizeReader();

export const fillMissingNowstaSizes = async (roster, { read = readSizes, now = Date.now, budgetMs = 10_000 } = {}) => {
  const result = roster.map((person) => ({ ...person, sizeSources: { ...person.sizeSources } }));
  const pending = result.filter((person) => person.companyUserId && SIZE_FIELDS.some((field) => !uniformSizeValue(person[field])));
  const deadline = now() + budgetMs;
  let next = 0; let failed = 0; let stop = false;
  const run = async () => {
    while (next < pending.length) {
      const person = pending[next++];
      if (stop || now() >= deadline) { failed += 1; continue; }
      try {
        const sizes = await read(person.companyUserId);
        for (const field of SIZE_FIELDS) if (!uniformSizeValue(person[field]) && uniformSizeValue(sizes[field])) {
          person[field] = uniformSizeValue(sizes[field]);
          person.sizeSources[field] = 'Nowsta API';
        }
        person.missingSizes = SIZE_FIELDS.filter((field) => field !== 'height' && !person[field]);
      } catch (error) {
        failed += 1;
        if ([401, 403, 429, 503].includes(error.statusCode)) stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, run));
  return { roster: result, sizeLookupWarning: failed
    ? `Nowsta sizes could not be loaded for ${failed} staff. Saved sizes are shown. Reload the event to try again.` : '' };
};
