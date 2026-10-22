export function resolveBarOfficeReview(event, input) {
  const row = event.importReview?.rows?.find((row) => row.id === input.rowId);
  if (!row || input.expectedRevision !== event.revision) throw Object.assign(new Error('The review changed. Refresh before confirming.'), { status: 409 });
  const review = { ...event.importReview, rows: event.importReview.rows.filter((r) => r.id !== row.id) };
  if (input.action === 'exclude') return { review, row, item: null };
  if (input.action !== 'confirm') throw Object.assign(new Error('Choose confirm or exclude'), { status: 400 });
  const name = String(input.name || '').trim();
  const kind = input.kind;
  const quantity = input.quantity === '' || input.quantity == null ? null : Number(input.quantity);
  if (!name || name.length > 240 || !['water', 'alcohol', 'cocktail', 'mocktail'].includes(kind)
    || quantity !== null && (!Number.isFinite(quantity) || quantity < 0 || quantity > 100000)) {
    throw Object.assign(new Error('Enter a drink name, type and valid quantity (or leave it pending).'), { status: 400 });
  }
  if ((event.items || []).some((item) => item.name.trim().toLowerCase() === name.toLowerCase())) {
    throw Object.assign(new Error('This drink already exists. Edit its existing row or exclude this duplicate.'), { status: 409 });
  }
  return { review, row, item: { name, beverageKind: kind, section: kind === 'alcohol' ? 'WINE / SPIRITS' : kind.toUpperCase(),
    scope: kind === 'alcohol' ? 'alcohol' : 'bar_support', quantity, sentQtyPending: quantity === null,
    quantityText: quantity === null ? '' : String(quantity), cocktailServingsAuto: false, entrySource: 'manual' } };
}
