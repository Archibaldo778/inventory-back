const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const safeQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const parseLocationsInput = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const normalizeProductLocations = (value, legacy = {}) => {
  const merged = new Map();
  parseLocationsInput(value).forEach((entry) => {
    const name = cleanText(entry?.name ?? entry?.location);
    if (!name) return;
    const key = name.toLowerCase();
    const previous = merged.get(key);
    merged.set(key, {
      name: previous?.name || name,
      quantity: safeQuantity(previous?.quantity) + safeQuantity(entry?.quantity ?? entry?.qty),
    });
  });

  if (!merged.size) {
    const name = cleanText(legacy?.location);
    const quantity = safeQuantity(legacy?.quantity ?? legacy?.qty);
    if (name || quantity > 0) {
      const resolvedName = name || 'Unassigned';
      merged.set(resolvedName.toLowerCase(), { name: resolvedName, quantity });
    }
  }
  return Array.from(merged.values());
};

export const buildProductLocationPayload = (value, legacy = {}) => {
  const locations = normalizeProductLocations(value, legacy);
  return {
    locations,
    location: locations[0]?.name || cleanText(legacy?.location),
    quantity: locations.length
      ? locations.reduce((sum, entry) => sum + entry.quantity, 0)
      : safeQuantity(legacy?.quantity ?? legacy?.qty),
  };
};
