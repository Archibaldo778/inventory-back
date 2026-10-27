const id = value => String(value?._id || value?.id || value || '');
const rowKey = (item, packout) => `${id(item.deckId || packout.deckId)}:${id(item.productId) || item.inventoryCode || String(item.name || '').toLowerCase()}`;

export const planDecorPackoutConsolidation = (packouts) => {
  const rows = packouts.filter(row => !row.supersededBy).sort((a, b) =>
    Number(Boolean(b.items?.length)) - Number(Boolean(a.items?.length))
    || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    || id(a).localeCompare(id(b)));
  const current = rows[0];
  if (!current) return null;
  if (rows.some(row => id(row.eventId) !== id(current.eventId))) throw new Error('Cannot combine different events');
  const items = [...(current.items || [])];
  const byKey = new Map(items.map(item => [rowKey(item, current), item]));
  for (const previous of rows.slice(1)) {
    for (const item of previous.items || []) {
      // Board quantities are reconciled from live pages, never summed from old snapshots.
      if (item.boardItemId) continue;
      const key = rowKey(item, previous);
      const existing = byKey.get(key);
      if (existing) {
        if (Number(existing.quantity) !== Number(item.quantity)) throw new Error(`Conflicting manual quantities for ${item.inventoryCode || item.name}`);
        continue;
      }
      const carried = { ...item, deckId: item.deckId || previous.deckId, pageId: item.pageId || previous.pageId };
      items.push(carried); byKey.set(key, carried);
    }
  }
  return { currentId: id(current), previousIds: rows.slice(1).map(id), items };
};
