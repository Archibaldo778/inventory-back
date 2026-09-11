import crypto from 'node:crypto';
import JSZip from 'jszip';

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

export const normalizeCatereaseKitchenMenuRows = (rows = []) => (Array.isArray(rows) ? rows : [])
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
    schemaVersion: 2,
    eventId: clean(eventId, 120),
    syncedAt,
    checksum,
    packOut,
    kitchenMenu,
  };
};

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const textRun = (value, { bold = false, size = 20 } = {}) => (
  `<w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`
);

const paragraph = (value, options = {}) => {
  const { bold = false, size = 20, align = '', before = 0, after = 0 } = options;
  return `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:before="${before}" w:after="${after}"/></w:pPr>${textRun(value, { bold, size })}</w:p>`;
};

const cell = (value, { bold = false, width = 0, shading = '' } = {}) => (
  `<w:tc><w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}${shading ? `<w:shd w:val="clear" w:fill="${shading}"/>` : ''}</w:tcPr>${paragraph(value, { bold, size: 18, after: 0 })}</w:tc>`
);

const table = (headers, rows, widths) => `<w:tbl>
  <w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders></w:tblPr>
  <w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>
  <w:tr>${headers.map((header, index) => cell(header, { bold: true, width: widths[index], shading: 'E7E6E6' })).join('')}</w:tr>
  ${rows.map((row) => `<w:tr>${row.map((value, index) => cell(value, { width: widths[index] })).join('')}</w:tr>`).join('')}
</w:tbl>`;

const formatQuantity = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return Number.isInteger(numeric) ? String(numeric) : String(Math.round(numeric * 1000) / 1000);
};

const groupedRows = (rows, groupSelector) => {
  const groups = new Map();
  rows.forEach((row) => {
    const key = clean(groupSelector(row), 160) || 'Unassigned';
    const values = groups.get(key) || [];
    values.push(row);
    groups.set(key, values);
  });
  return groups;
};

const documentXml = ({ event, snapshot, type }) => {
  const isKitchenProduction = type === 'kitchen_production' || type === 'kitchen_menu';
  const currentMapping = Number(snapshot?.schemaVersion) >= 2;
  const rows = isKitchenProduction
    ? (currentMapping ? snapshot?.kitchenMenu : snapshot?.packOut) || []
    : (currentMapping ? snapshot?.packOut : snapshot?.kitchenMenu) || [];
  const title = isKitchenProduction ? 'KITCHEN PRODUCTION' : 'PACK OUT';
  const groups = groupedRows(rows, (row) => (
    isKitchenProduction
      ? row.station || row.prepArea
      : row.menuGroup || row.category || row.prepArea
  ));
  const sections = [...groups.entries()].map(([group, values]) => {
    const bodyRows = values.map((row) => (
      isKitchenProduction
        ? [formatQuantity(row.quantity), row.unit, row.itemName, row.prepArea]
        : [formatQuantity(row.quantity), row.itemName, [row.category, row.subEvent].filter(Boolean).join(' · '), '', '']
    ));
    return `${paragraph(group.toUpperCase(), { bold: true, size: 22, before: 220, after: 80 })}${
      isKitchenProduction
        ? table(['Qty', 'Unit', 'Required item', 'Prep area'], bodyRows, [900, 1200, 5200, 1800])
        : table(['Qty', 'Name', 'Notes / Comments', 'Delivered', 'Returned'], bodyRows, [750, 3600, 3800, 1050, 1050])
    }`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  ${paragraph('OLIVIER CHENG', { bold: true, size: 32, align: 'center', after: 0 })}
  ${paragraph('C A T E R I N G  A N D  E V E N T S', { size: 14, align: 'center', after: 180 })}
  ${paragraph(title, { bold: true, size: 34, align: 'center', after: 160 })}
  ${table(['Event', 'Event date', 'Event number'], [[event?.title || 'Event', event?.date || '', event?.externalId || snapshot?.eventId || '']], [5200, 2200, 2600])}
  ${sections || paragraph('No rows returned by Caterease.', { size: 20, before: 240 })}
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
};

export const renderCatereaseOperationalDocx = async ({ event, snapshot, type }) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const word = zip.folder('word');
  word.file('document.xml', documentXml({ event, snapshot, type }));
  word.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`);
  word.folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
