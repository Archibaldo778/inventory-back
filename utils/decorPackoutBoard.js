const BOARD_ITEM_SIZE = 92;

const text = (value) => String(value || '').trim();
const idOf = (value) => text(value?._id || value?.id || value);

const escapeSvgText = (value) => text(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const decorPackoutPlaceholder = (name) => {
  const label = escapeSvgText(name || 'Inventory item').slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><rect width="360" height="360" rx="28" fill="#f4f3ef"/><path d="M121 133h118v94H121z" fill="none" stroke="#a8a49a" stroke-width="10"/><path d="m132 212 38-42 27 29 19-21 34 39" fill="none" stroke="#a8a49a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="211" cy="157" r="12" fill="#a8a49a"/><text x="180" y="274" fill="#575a60" font-family="Arial,sans-serif" font-size="18" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const itemImage = (item) => text(item?.image || item?.imageUrl || item?.images?.[0]);

export const buildDecorPackoutCanvas = (canvasValue, packoutValue) => {
  const canvas = canvasValue && typeof canvasValue === 'object' ? canvasValue : {};
  const packoutId = idOf(packoutValue);
  if (!packoutId) return { canvas, changed: false };

  const items = Array.isArray(packoutValue?.items) ? packoutValue.items : [];
  const expected = new Map(items.map((item) => [idOf(item), item]).filter(([itemId]) => itemId));
  let changed = false;
  const images = [];

  (Array.isArray(canvas.images) ? canvas.images : []).forEach((image) => {
    if (text(image?.decorPackoutId) !== packoutId) {
      images.push(image);
      return;
    }
    const itemId = text(image?.decorPackoutItemId);
    const item = expected.get(itemId);
    if (!item) {
      changed = true;
      return;
    }
    expected.delete(itemId);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const src = itemImage(item) || text(image?.src) || decorPackoutPlaceholder(item.name);
    const next = {
      ...image,
      src,
      productId: idOf(item.productId),
      inventoryCode: text(item.inventoryCode).toUpperCase(),
      inventoryType: text(item.inventoryType) || 'decor',
      name: text(item.name) || 'Inventory item',
      initialName: text(item.name) || 'Inventory item',
      description: text(item.description),
      quantity,
      quantityText: String(quantity),
    };
    if (JSON.stringify(next) !== JSON.stringify(image)) changed = true;
    images.push(next);
  });

  expected.forEach((item, itemId) => {
    const slot = images.filter((image) => image && image.type !== 'text' && image.type !== 'table').length;
    const quantity = Math.max(1, Number(item.quantity) || 1);
    images.push({
      id: `packout-${packoutId}-${itemId}`,
      src: itemImage(item) || decorPackoutPlaceholder(item.name),
      x: 48 + ((slot % 7) * 132),
      y: 56 + ((Math.floor(slot / 7) % 5) * 142),
      width: BOARD_ITEM_SIZE,
      height: BOARD_ITEM_SIZE,
      productId: idOf(item.productId),
      inventoryCode: text(item.inventoryCode).toUpperCase(),
      inventoryType: text(item.inventoryType) || 'decor',
      decorPackoutId: packoutId,
      decorPackoutItemId: itemId,
      name: text(item.name) || 'Inventory item',
      initialName: text(item.name) || 'Inventory item',
      description: text(item.description),
      quantity,
      quantityText: String(quantity),
      vendorType: 'OCC',
      vendorCustom: '',
    });
    changed = true;
  });

  return { canvas: changed ? { ...canvas, images } : canvas, changed };
};
