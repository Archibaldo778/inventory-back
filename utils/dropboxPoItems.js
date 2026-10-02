const decode = (value) => String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const cellText = (value) => decode(value.replace(/<\/w:p>/g, ' ').replace(/<[^>]*>/g, '')).trim();

// Keep empty cells: a blank Qty must not shift a comment into the quantity column.
export const extractDropboxPoItems = (xml) => {
  const items = [];
  let zone = 'Pack Out';
  let columns = null;
  for (const row of String(xml).match(/<w:tr\b[\s\S]*?<\/w:tr>/gi) || []) {
    const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/gi) || []).map(cellText);
    const itemColumn = cells.findIndex((cell) => /^(name|item|item name|description|product)$/i.test(cell));
    const qtyColumn = cells.findIndex((cell) => /^(qty\.?|quantity|qty required|ordered)$/i.test(cell));
    if (itemColumn >= 0 && qtyColumn >= 0) {
      columns = { item: itemColumn, qty: qtyColumn, notes: cells.findIndex((cell) => /notes|comments/i.test(cell)), unit: cells.findIndex((cell) => /^(unit|units|uom)$/i.test(cell)) };
      continue;
    }
    if (!columns) continue;
    const filled = cells.filter(Boolean);
    if (filled.length === 1 && cells.length === 1) { zone = filled[0].slice(0, 200); continue; }
    const itemName = cells[columns.item];
    if (!itemName || /^total\b/i.test(itemName)) continue;
    const quantityText = String(cells[columns.qty] || '').replace(/,/g, '').trim();
    const amount = quantityText.match(/^(\d+(?:\.\d+)?)\s*([a-z .]*)$/i);
    const quantity = amount ? Number(amount[1]) : null;
    if (quantity === 0) continue;
    items.push({ itemName: itemName.slice(0, 300), quantity,
      unit: String(cells[columns.unit] || amount?.[2] || '').trim().slice(0, 80),
      notes: String(cells[columns.notes] || '').slice(0, 1000), zoneName: zone });
    if (items.length >= 3000) break;
  }
  return items;
};
