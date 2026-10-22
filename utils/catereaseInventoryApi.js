const clean = (value) => String(value ?? '').trim();

export function createInventoryClient({ key = process.env.CATEREASE_INVENTORY_API_KEY, fetchImpl = fetch } = {}) {
  const request = async (path, options = {}) => {
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
    return response.json();
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
    create(payload, key) {
      return request('/v1/menu-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
    },
  };
}

export function inventoryDestination(menus, types, locNum = '00001') {
  const matches = menus.filter(m => clean(m.Title).toLowerCase() === 'occ inventory' && m.LocNum === locNum && !m.Inactive);
  if (matches.length !== 1) throw new Error(matches.length ? 'Multiple OCC Inventory catalogs found' : 'Create an active OCC Inventory catalog in Caterease first');
  const equipment = types.filter(t => t.LocNum === locNum && t.Active && clean(t.Caption).toLowerCase() === 'equipment');
  if (equipment.length !== 1) throw new Error('A unique active Equipment item type is required');
  return { locNum, menuNum: matches[0].MenuNum, itemType: equipment[0].ID };
}

export function inventoryPayload(product, destination) {
  if (!clean(product.name) || !/^OCC\d+$/i.test(clean(product.inventoryCode))) throw new Error('Product needs a name and an OCC inventory code');
  return {
    ...destination,
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
