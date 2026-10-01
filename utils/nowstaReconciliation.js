export const missingNowstaScheduleIds = (existingEntries = [], currentEntries = []) => {
  const currentIds = new Set((Array.isArray(currentEntries) ? currentEntries : [])
    .map((entry) => String(entry?.nowstaEventId || '').trim())
    .filter(Boolean));
  return [...new Set((Array.isArray(existingEntries) ? existingEntries : [])
    .map((entry) => String(entry?.nowstaEventId || '').trim())
    .filter((id) => id && !currentIds.has(id)))];
};
