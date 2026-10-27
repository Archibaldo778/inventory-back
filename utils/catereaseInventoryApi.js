import { inventoryStockPayload } from './catereaseInventoryStock.js';
import { normalizeProductImages } from './productImages.js';
const clean = (value) => String(value ?? '').trim();

export function createInventoryClient({ key = process.env.CATEREASE_INVENTORY_API_KEY, fetchImpl = fetch } = {}) {
  const request = async (path, options = {}, raw = false) => {
    if (!clean(key)) throw new Error('CATEREASE_INVENTORY_API_KEY is not configured');
    const response = await fetchImpl(`https://caterease.app${path}`, {
      ...options,
      headers: { 'X-API-Key': key, Accept: 'application/json', ...options.headers },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      let code = '';
      try { code = clean((await response.json())?.error?.code); } catch { /* empty response */ }
      throw Object.assign(new Error(`Caterease HTTP ${response.status}${code ? ` (${code})` : ''}`), { statusCode: response.status });
    }
    return raw ? response : response.json();
  };
  return {
    async list(resource, locNum = '00001') {
      if (!['menu', 'menuitem', 'foodservtype'].includes(resource)) throw new Error('Unsupported inventory resource');
      const rows = [], cursors = new Set();
      let cursor = '';
      do {
        const params = new URLSearchParams({ limit: '200', locNum });
        if (resource === 'menuitem') params.set('fields', 'LocNum,MenuNum,ItemID,ItemName,ItemNum,Inactive');
        if (cursor) params.set('cursor', cursor);
        const page = await request(`/v1/${resource}?${params}`);
        if (!Array.isArray(page.data) || typeof page.pagination?.hasMore !== 'boolean') throw new Error('Incomplete Caterease catalog response');
        rows.push(...page.data);
        cursor = page.pagination?.hasMore ? clean(page.pagination.nextCursor) : '';
        if (page.pagination?.hasMore && (!cursor || cursors.has(cursor))) throw new Error('Incomplete Caterease catalog pagination');
        cursors.add(cursor);
      } while (cursor);
      return rows;
    },
    async readStock(itemNum, locNum) {
      const params = new URLSearchParams({ locNum, itemId: itemNum, fields: 'ItemNum,ItemID,LocNum,MenuNum,Inactive,InvItem,InvInstock', limit: '2' });
      const page = await request(`/v1/menuitem?${params}`);
      if (!Array.isArray(page.data) || page.data.length !== 1 || page.pagination?.hasMore) throw new Error('Stock item missing or ambiguous');
      return page.data[0];
    },
    async patchStock(itemNum, locNum, payload) {
      const path = `/v1/menu-items/${encodeURIComponent(itemNum)}`;
      const query = `?${new URLSearchParams({ locNum })}`;
      const version = await request(`${path}/version${query}`, {}, true);
      const etag = version.headers.get('etag');
      if (!etag) throw new Error('Caterease stock update requires an ETag');
      return request(`${path}${query}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify(payload),
      });
    },
    create(payload, key) {
      return request('/v1/menu-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
    },
  };
}

export function inventoryDestination(menus, types, locNum = '00001') {
  const path = ['Pack Out New', 'Account Rep PO', 'OCCDecks'];
  const matchesPath = (menu) => {
    let current = menu;
    for (let i = path.length - 1; i >= 0; i--) {
      if (!current || current.LocNum !== locNum || current.Inactive || clean(current.Title) !== path[i]) return false;
      if (i === 0) return current.ParentID == null || current.ParentID === 0;
      const parents = menus.filter(m => m.LocNum === locNum && m.ID === current.ParentID);
      if (parents.length !== 1) return false;
      current = parents[0];
    }
    return false;
  };
  const matches = menus.filter(matchesPath);
  if (matches.length !== 1) throw new Error(matches.length ? 'Multiple OCCDecks catalogs found at the configured path' : 'Active catalog Pack Out New → Account Rep PO → OCCDecks was not found');
  const equipment = types.filter(t => t.LocNum === locNum && t.Active && clean(t.Caption).toLowerCase() === 'equipment');
  if (equipment.length !== 1) throw new Error('A unique active Equipment item type is required');
  return { locNum, menuNum: matches[0].MenuNum, itemType: equipment[0].ID };
}

// Only categories explicitly enabled for submenus are routed away from the root.
export function inventoryCategoryDestination(product, destination, menus) {
  const category = clean(product.category).toLowerCase();
  const submenuTitles = [
    'Trays', 'Additional supplies', 'Bar Equipment', 'Basket', 'Beverage Serveware',
    'Beverage Tubs', 'Bowls', 'Candle Holders Votives', 'Cutting Board', 'Decor',
    'Inserts', 'Kitchen Equipment', 'Knives', 'Plates', 'Platter',
    'Electrical Equipment & Power Supplies', 'Risers', 'Side Serveware', 'Tabletop',
    'Staff Items', 'Disposable', 'Caviar Servers',
  ];
  const target = category === 'candle holders / votives' ? 'candle holders votives' : category;
  if (!submenuTitles.some(title => title.toLowerCase() === target)) return destination;
  const roots = menus.filter(m => m.LocNum === destination.locNum && m.MenuNum === destination.menuNum && !m.Inactive);
  if (roots.length !== 1) throw new Error('OCCDecks root is missing or ambiguous');
  const matches = menus.filter(m => m.LocNum === destination.locNum && m.ParentID === roots[0].ID
    && !m.Inactive && clean(m.Title).toLowerCase() === target);
  if (matches.length !== 1) throw new Error(`A unique active OCCDecks submenu is required for ${product.category}`);
  return { ...destination, menuNum: matches[0].MenuNum };
}

export const isExportableInventoryProduct = (product) => !String(product?.category || '').startsWith('__event_board_tape_library__:');

export function inventoryPayload(product, destination) {
  if (!clean(product.name) || !/^OCC\d+$/i.test(clean(product.inventoryCode))) throw new Error('Product needs a name and an OCC inventory code');
  const photo = normalizeProductImages(product)[0];
  return {
    ...destination,
    ...inventoryStockPayload(product),
    ...(photo && /^https:\/\//i.test(photo) ? { url: photo } : {}),
    itemName: product.name,
    itemID: clean(product.inventoryCode).toUpperCase(),
    description: clean(product.description),
    category: clean(product.category),
    inactive: false,
  };
}

export function existingInventoryItem(items, payload) {
  const matches = items.filter(i => i.LocNum === payload.locNum && i.MenuNum === payload.menuNum && clean(i.ItemID).toUpperCase() === payload.itemID);
  if (matches.length > 1) throw new Error(`Duplicate OCC code in Caterease: ${payload.itemID}`);
  const item = matches[0];
  if (item && (item.Inactive || item.ItemName !== payload.itemName)) throw new Error(`Existing Caterease item needs review: ${payload.itemID}`);
  return item || null;
}

// An ambiguous create is reconciled on a later read, never blindly repeated.
export async function deliverInventoryJob(job, remote, client) {
  const existing = existingInventoryItem(remote, job.payload);
  if (existing) return { status: 'sent', itemNum: existing.ItemNum };
  if (job.status !== 'pending') return { status: 'review', error: 'Previous create outcome is unknown; check Caterease before retrying' };
  try {
    const result = await client.create(job.payload, job.idempotencyKey);
    if (!result?.itemNum) return { status: 'review', error: 'Caterease did not return the created item number' };
    return { status: 'sent', itemNum: result.itemNum };
  } catch (error) {
    const rejected = error.statusCode >= 400 && error.statusCode < 500 && ![408, 409].includes(error.statusCode);
    return { status: rejected ? 'failed' : 'review', error: error.message };
  }
}
