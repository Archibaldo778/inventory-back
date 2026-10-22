export const productCategoryUpdate = (current, category) => {
  const requested = String(category || '').trim();
  const updates = { category: requested || 'Trays' };
  const previous = String(current.category || '').trim().toLowerCase();
  if (current.inventoryType === 'disposable'
    && requested
    && requested.toLowerCase() !== previous
    && requested.toLowerCase() !== 'disposable'
    && !/^__event_board_tape_library__(?::|$)/i.test(requested)) {
    updates.inventoryType = 'decor';
  }
  return updates;
};
