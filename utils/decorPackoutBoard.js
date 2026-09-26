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

const canvasProductKey = (item) => {
  const productId = idOf(item?.productId);
  const inventoryCode = text(item?.inventoryCode).toUpperCase();
  return productId || inventoryCode;
};

export const removeGeneratedDecorPackoutDuplicates = (imagesValue, packoutValue) => {
  const images = Array.isArray(imagesValue) ? imagesValue : [];
  const packoutId = idOf(packoutValue);
  if (!packoutId) return images;
  const generatedPrefix = `packout-${packoutId}-`;
  const manualProductKeys = new Set();
  const manualPackoutItemIds = new Set();
  images.forEach((item) => {
    if (text(item?.id).startsWith(generatedPrefix)) return;
    const key = canvasProductKey(item);
    const itemId = text(item?.decorPackoutItemId);
    if (key) manualProductKeys.add(key);
    if (itemId) manualPackoutItemIds.add(itemId);
  });
  const retainedGeneratedItemIds = new Set();
  return images.filter((item) => {
    const generated = text(item?.id).startsWith(generatedPrefix);
    if (!generated) return true;
    const key = canvasProductKey(item);
    const itemId = text(item?.decorPackoutItemId);
    if ((key && manualProductKeys.has(key)) || (itemId && manualPackoutItemIds.has(itemId))) return false;
    if (itemId && retainedGeneratedItemIds.has(itemId)) return false;
    if (itemId) retainedGeneratedItemIds.add(itemId);
    return true;
  });
};

export const preserveUnplacedDecorPackoutItems = (previousItemsValue, reconciledItemsValue, matchedItemIdsValue) => {
  const previousItems = Array.isArray(previousItemsValue) ? previousItemsValue : [];
  const reconciledItems = Array.isArray(reconciledItemsValue) ? reconciledItemsValue : [];
  const matchedItemIds = matchedItemIdsValue instanceof Set ? matchedItemIdsValue : new Set(matchedItemIdsValue || []);
  const result = [...reconciledItems];
  previousItems.forEach((item) => {
    const itemId = idOf(item);
    if ((itemId && matchedItemIds.has(itemId)) || text(item?.boardItemId)) return;
    result.push(item);
  });
  return result;
};

export const decorPackoutNeedsBoardSync = (itemsValue, canvasItemIdsValue = new Set()) => {
  const items = Array.isArray(itemsValue) ? itemsValue : [];
  const canvasItemIds = canvasItemIdsValue instanceof Set ? canvasItemIdsValue : new Set(canvasItemIdsValue || []);
  return items.some((item) => {
    const itemId = idOf(item);
    return !text(item?.boardItemId) && (!itemId || !canvasItemIds.has(itemId));
  });
};

export const selectReusableDecorPackoutDraft = (packoutsValue) => {
  const drafts = (Array.isArray(packoutsValue) ? packoutsValue : [])
    .filter((packout) => packout?.status === 'draft');
  return drafts.find((packout) => Array.isArray(packout?.items) && packout.items.length > 0)
    || drafts[0]
    || null;
};

export const buildDecorPackoutCanvas = (canvasValue, packoutValue) => {
  const canvas = canvasValue && typeof canvasValue === 'object' ? canvasValue : {};
  const packoutId = idOf(packoutValue);
  if (!packoutId) return { canvas, changed: false };

  const items = Array.isArray(packoutValue?.items) ? packoutValue.items : [];
  const expected = new Map(items.map((item) => [idOf(item), item]).filter(([itemId]) => itemId));
  const expectedByBoardItemId = new Map(items
    .map((item) => [text(item?.boardItemId), idOf(item)])
    .filter(([boardItemId, itemId]) => boardItemId && itemId));
  let changed = false;
  const images = [];
  const generatedPrefix = `packout-${packoutId}-`;

  (Array.isArray(canvas.images) ? canvas.images : []).forEach((image) => {
    const linkedPackoutId = text(image?.decorPackoutId);
    let itemId = text(image?.decorPackoutItemId);
    if (!linkedPackoutId && expectedByBoardItemId.has(text(image?.id))) {
      itemId = expectedByBoardItemId.get(text(image?.id));
    } else if (linkedPackoutId !== packoutId) {
      images.push(image);
      return;
    }
    const item = expected.get(itemId);
    if (!item) {
      changed = true;
      return;
    }
    expected.delete(itemId);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const src = itemImage(item) || text(image?.src) || decorPackoutPlaceholder(item.name);
    const generated = text(image?.id).startsWith(generatedPrefix);
    const next = {
      ...image,
      src,
      productId: idOf(item.productId),
      inventoryCode: text(item.inventoryCode).toUpperCase(),
      inventoryType: text(item.inventoryType) || 'decor',
      decorPackoutId: packoutId,
      decorPackoutItemId: itemId,
      name: text(item.name) || 'Inventory item',
      initialName: text(item.name) || 'Inventory item',
      description: text(item.description),
      ...(generated ? { quantity, quantityText: String(quantity) } : {}),
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
