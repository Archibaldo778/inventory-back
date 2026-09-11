import crypto from 'node:crypto';

const clean = (value, maxLength = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
const booleanValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'y', 'on'].includes(clean(value).toLowerCase());
};
const first = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return '';
};
const fallbackSourceId = (row) => `row-${crypto.createHash('sha1').update(JSON.stringify(row || {})).digest('hex').slice(0, 16)}`;

export const normalizeCatereasePackOutRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    sourceId: clean(first(row, ['UID', 'ReqItemNum', 'RINum', 'ItemNum', 'ID']), 120) || fallbackSourceId(row),
    itemName: clean(first(row, ['ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    purchaseUnit: clean(first(row, ['PUnit', 'PurchaseUnit']), 80),
    quantityPerPurchaseUnit: numberOrNull(first(row, ['QtyPerPUnit', 'PUnitQty'])),
    prepArea: clean(first(row, ['FSPrepArea', 'PrepArea']), 160),
    station: clean(first(row, ['FSName', 'FoodServiceName']), 240),
    rentalItem: booleanValue(first(row, ['RentalItem', 'IsRental'])),
    vendor: clean(first(row, ['Vendor', 'VendorName']), 200),
    serviceDate: clean(first(row, ['SEvtDate', 'EventDate']), 40),
    startTime: clean(first(row, ['StartTime']), 40),
  }))
  .filter((row) => row.itemName);

export const normalizeCatereaseKitchenMenuRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    sourceId: clean(first(row, ['UID', 'FSNum', 'ItemNum', 'ItemID', 'ID']), 120) || fallbackSourceId(row),
    itemId: clean(first(row, ['ItemNum', 'ItemID']), 120),
    itemName: clean(first(row, ['ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    prepArea: clean(first(row, ['PrepArea', 'FSPrepArea']), 160),
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    category: clean(first(row, ['Category']), 160),
    menuGroup: clean(first(row, ['MenuGroup', 'GroupName']), 160),
    notes: clean(first(row, ['Notes', 'Comment', 'Instructions']), 1000),
  }))
  .filter((row) => row.itemName);

const stableRows = (rows) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

export const buildCatereaseOperationalSnapshot = ({ eventId, packOutRows = [], kitchenMenuRows = [], syncedAt = new Date() } = {}) => {
  const packOut = normalizeCatereasePackOutRows(packOutRows);
  const kitchenMenu = normalizeCatereaseKitchenMenuRows(kitchenMenuRows);
  const checksum = crypto.createHash('sha256').update(JSON.stringify({
    eventId: clean(eventId, 120),
    packOut: stableRows(packOut),
    kitchenMenu: stableRows(kitchenMenu),
  })).digest('hex');
  return {
    eventId: clean(eventId, 120),
    syncedAt,
    checksum,
    packOut,
    kitchenMenu,
  };
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const renderCatereaseOperationalHtml = ({ event, snapshot, type }) => {
  const isKitchen = type === 'kitchen_menu';
  const rows = isKitchen ? snapshot?.kitchenMenu || [] : snapshot?.packOut || [];
  const groupKey = isKitchen ? 'prepArea' : 'prepArea';
  const groups = new Map();
  rows.forEach((row) => {
    const key = clean(row?.[groupKey], 160) || 'Unassigned';
    const values = groups.get(key) || [];
    values.push(row);
    groups.set(key, values);
  });
  const sections = [...groups.entries()].map(([group, values]) => `
    <section><h2>${escapeHtml(group)}</h2><table><thead><tr><th>Qty</th><th>Unit</th><th>Item</th><th>${isKitchen ? 'Menu group / zone' : 'Station'}</th></tr></thead><tbody>
      ${values.map((row) => `<tr><td>${escapeHtml(row.quantity ?? '')}</td><td>${escapeHtml(row.unit)}</td><td>${escapeHtml(row.itemName)}</td><td>${escapeHtml(isKitchen ? [row.menuGroup, row.subEvent].filter(Boolean).join(' · ') : row.station)}</td></tr>`).join('')}
    </tbody></table></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(event?.title)} — ${isKitchen ? 'Kitchen Menu' : 'Pack Out'}</title><style>body{font:14px Arial,sans-serif;color:#111;margin:32px}h1{margin-bottom:4px}header p{margin:3px 0;color:#555}section{break-inside:avoid;margin-top:24px}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #bbb;text-align:left}th{background:#eee}@media print{body{margin:12mm}}</style></head><body><header><h1>${escapeHtml(event?.title || 'Event')}</h1><p>${escapeHtml(event?.date || '')} · ${escapeHtml(event?.externalId || snapshot?.eventId || '')}</p><p>${isKitchen ? 'Kitchen Menu' : 'Pack Out'} · generated from current Caterease data</p></header>${sections || '<p>No rows returned by Caterease.</p>'}</body></html>`;
};
