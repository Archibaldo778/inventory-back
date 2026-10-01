export const missingNowstaScheduleIds = (existingEntries = [], currentEntries = []) => {
  const currentIds = new Set((Array.isArray(currentEntries) ? currentEntries : [])
    .map((entry) => String(entry?.nowstaEventId || '').trim())
    .filter(Boolean));
  return [...new Set((Array.isArray(existingEntries) ? existingEntries : [])
    .map((entry) => String(entry?.nowstaEventId || entry?.meta?.nowsta?.apiEventId || '').trim())
    .filter((id) => id && !currentIds.has(id)))];
};

export const nowstaScheduleUpsert = (entry, syncedAt) => ({
  updateOne: {
    filter: { nowstaEventId: entry.nowstaEventId },
    update: { $set: { ...entry, archived: entry.archived === true, lastSyncedAt: syncedAt } },
    upsert: true,
  },
});
