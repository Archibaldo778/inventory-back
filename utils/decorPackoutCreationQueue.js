const pending = new Map();

// Coalesce overlapping opens in this API process without changing any record IDs.
export const serializeDecorPackoutCreation = async (eventId, task) => {
  const previous = pending.get(eventId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  pending.set(eventId, current);
  try { return await current; }
  finally { if (pending.get(eventId) === current) pending.delete(eventId); }
};
