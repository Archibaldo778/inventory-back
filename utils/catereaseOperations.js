import crypto from 'node:crypto';
import JSZip from 'jszip';
import { catereaseRichTextToPlain } from './catereaseKitchen.js';
import { buildExactRecipeMatchIndex, resolveExactRecipeMatch } from './kitchenRecipeMatching.js';

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
    sourceId: clean(first(row, ['UID', 'FdSvNum', 'FSNum', 'ItemNum', 'ItemID', 'ID']), 120) || fallbackSourceId(row),
    itemId: clean(first(row, ['ItemNum', 'ItemID']), 120),
    itemName: clean(first(row, ['ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    prepArea: clean(first(row, ['PrepArea', 'FSPrepArea']), 160),
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    zoneName: clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200),
    category: clean(first(row, ['Category']), 160),
    menuGroup: clean(first(row, ['MenuGroup', 'FSCategory', 'GroupName']), 160),
    notes: clean(first(row, ['Notes', 'Comment', 'Instructions']), 1000),
  }))
  .filter((row) => row.itemName && row.menuGroup.toLowerCase() !== 'standard');

export const normalizeCatereaseKitchenPackOutRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    sourceId: clean(first(row, ['UID', 'ReqItemNum', 'RINum', 'ItemNum', 'ID']), 120) || fallbackSourceId(row),
    itemName: clean(first(row, ['OTFItemName', 'ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    purchaseUnit: clean(first(row, ['PUnit', 'PurchaseUnit']), 80),
    quantityPerPurchaseUnit: numberOrNull(first(row, ['QtyPerPUnit', 'PUnitQty'])),
    prepArea: clean(first(row, ['FSPrepArea', 'PrepArea']), 160),
    station: clean(first(row, ['FSName', 'FoodServiceName']), 240),
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    zoneName: clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200),
    rentalItem: booleanValue(first(row, ['RentalItem', 'IsRental'])),
    vendor: clean(first(row, ['Vendor', 'VendorName']), 200),
    serviceDate: clean(first(row, ['SEvtDate', 'EventDate']), 40),
    startTime: clean(first(row, ['StartTime']), 40),
  }))
  .filter((row) => row.itemName);

export const normalizeCatereaseStaffRequestRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    sourceId: clean(first(row, ['ShiftNum', 'UID', 'ID']), 120) || fallbackSourceId(row),
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    zoneName: clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200),
    position: clean(first(row, ['Position', 'Title']), 200),
    required: numberOrNull(first(row, ['Required', 'Qty', 'Quantity'])),
    startTime: clean(first(row, ['StartTime', 'SftFrom']), 80),
    endTime: clean(first(row, ['EndTime', 'SftTo']), 80),
    category: clean(first(row, ['Category']), 160),
    comments: clean(first(row, ['Comments', 'Comment', 'Notes']), 1000),
    uniform: clean(first(row, ['Uniform']), 300),
  }))
  .filter((row) => row.position);

const isKitchenMenuNoise = (value) => {
  const name = clean(value, 300).toLowerCase();
  return !name || /^option\s+[a-z0-9]+\s*:/.test(name) || /^\d+(?:\.\d+)?\+?\s*hours?\b/.test(name);
};

export const buildKitchenMenuRows = (kitchenPackOutRows = []) => {
  const dishes = new Map();
  (Array.isArray(kitchenPackOutRows) ? kitchenPackOutRows : []).forEach((row) => {
    const name = clean(row?.station, 300);
    if (isKitchenMenuNoise(name)) return;
    const zoneName = clean(row?.zoneName, 200);
    const subEvent = clean(row?.subEvent, 120);
    const zoneKey = (zoneName || subEvent).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${zoneKey}|${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (!key) return;
    const existing = dishes.get(key);
    if (existing) {
      existing.componentCount += 1;
      existing.components.push({
        name: clean(row?.itemName, 300),
        quantity: numberOrNull(row?.quantity),
        unit: clean(row?.unit, 80),
      });
      if (!existing.prepArea && row?.prepArea) existing.prepArea = clean(row.prepArea, 160);
      return;
    }
    dishes.set(key, {
      sourceId: `dish-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`,
      itemName: name,
      prepArea: clean(row?.prepArea, 160),
      subEvent,
      zoneName,
      componentCount: 1,
      components: [{
        name: clean(row?.itemName, 300),
        quantity: numberOrNull(row?.quantity),
        unit: clean(row?.unit, 80),
      }],
    });
  });
  return [...dishes.values()];
};

export const normalizeCatereaseKitchenMenuDishRows = (rows = []) => {
  const dishes = new Map();
  (Array.isArray(rows) ? rows : []).slice(0, 10000).forEach((row) => {
    const itemName = clean(first(row, ['ItemName', 'Name', 'Title']), 300);
    if (isKitchenMenuNoise(itemName)) return;
    const subEvent = clean(first(row, ['SubEvtNum', 'SubEvent']), 120);
    const zoneName = clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200);
    const key = `${(zoneName || subEvent).toLowerCase()}|${itemName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (!itemName || dishes.has(key)) return;
    dishes.set(key, {
      sourceId: clean(first(row, ['UID', 'FdSvNum', 'FSNum', 'ItemNum', 'ItemID', 'ID']), 120) || fallbackSourceId(row),
      itemName,
      quantity: numberOrNull(first(row, ['Qty', 'Quantity', 'Servings', 'RServings'])),
      unit: clean(first(row, ['Unit']), 80),
      prepArea: clean(first(row, ['PrepArea', 'FSPrepArea']), 160),
      subEvent,
      zoneName,
      category: clean(first(row, ['Category', 'FSCategory']), 160),
      menuGroup: clean(first(row, ['MenuGroup', 'FSCategory', 'GroupName']), 160),
      description: clean(catereaseRichTextToPlain(first(row, ['Description', 'UseDesc'])), 12000),
      notes: clean(catereaseRichTextToPlain(first(row, ['Comment', 'Notes'])), 12000),
    });
  });
  return [...dishes.values()];
};

const mergeKitchenMenuRows = (derivedRows = [], directRows = []) => {
  const directByName = new Map();
  directRows.forEach((row) => {
    const key = `${clean(row?.zoneName || row?.subEvent, 200).toLowerCase()}|${clean(row?.itemName, 300).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (key && !directByName.has(key)) directByName.set(key, row);
  });
  return derivedRows.map((row) => {
    const key = `${clean(row?.zoneName || row?.subEvent, 200).toLowerCase()}|${clean(row?.itemName, 300).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const direct = directByName.get(key);
    if (!direct) return row;
    return {
      ...direct,
      ...row,
      quantity: direct.quantity,
      unit: direct.unit,
      subEvent: direct.subEvent,
      category: direct.category,
      menuGroup: direct.menuGroup,
      description: direct.description,
      notes: direct.notes,
    };
  });
};

const stableRows = (rows) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const maximumPositiveValue = (rows, keys) => {
  const values = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const value = numberOrNull(first(row, keys));
    return value !== null && value > 0 ? [value] : [];
  });
  return values.length ? Math.max(...values) : null;
};

export const catereaseOperationalGuestCount = (rows = [], legacyGuestCount = null) => {
  const actual = maximumPositiveValue(rows, ['ActGuests', 'ActualGuests']);
  const guaranteed = maximumPositiveValue(rows, ['GtdGuests', 'GuaranteedGuests']);
  const planned = maximumPositiveValue(rows, ['PlnGuests', 'PlannedGuests']);
  if (actual !== null) return guaranteed !== null ? Math.max(actual, guaranteed) : actual;
  if (guaranteed !== null) return guaranteed;
  if (planned !== null) return planned;
  return numberOrNull(legacyGuestCount);
};

export const buildCatereaseOperationalSnapshot = ({
  eventId,
  packOutRows = [],
  kitchenPackOutRows = [],
  kitchenMenuRows,
  staffRequestRows = [],
  sourceErrors = [],
  syncedAt = new Date(),
} = {}) => {
  const guestRow = (Array.isArray(packOutRows) ? packOutRows : []).find((row) => (
    clean(first(row, ['ItemName', 'Name', 'Title'])).toLowerCase() === 'food'
    && clean(first(row, ['MenuGroup', 'GroupName'])).toLowerCase() === 'standard'
  ));
  const guestCount = catereaseOperationalGuestCount(
    packOutRows,
    first(guestRow, ['Qty', 'Quantity'])
  );
  const packOut = normalizeCatereasePackOutRows(packOutRows);
  const kitchenPackOut = normalizeCatereaseKitchenPackOutRows(kitchenPackOutRows);
  const directKitchenMenu = normalizeCatereaseKitchenMenuDishRows(kitchenMenuRows);
  const derivedKitchenMenu = buildKitchenMenuRows(kitchenPackOut);
  const kitchenMenu = derivedKitchenMenu.length
    ? mergeKitchenMenuRows(derivedKitchenMenu, directKitchenMenu)
    : directKitchenMenu;
  const zoneNameBySubEvent = new Map(
    [...packOut, ...kitchenPackOut, ...directKitchenMenu]
      .filter((row) => row?.subEvent && row?.zoneName)
      .map((row) => [clean(row.subEvent, 120).toLowerCase(), clean(row.zoneName, 200)])
  );
  const staffRequest = normalizeCatereaseStaffRequestRows(staffRequestRows).map((row) => ({
    ...row,
    zoneName: row.zoneName || zoneNameBySubEvent.get(clean(row.subEvent, 120).toLowerCase()) || '',
  }));
  const checksum = crypto.createHash('sha256').update(JSON.stringify({
    eventId: clean(eventId, 120),
    guestCount,
    packOut: stableRows(packOut),
    kitchenPackOut: stableRows(kitchenPackOut),
    kitchenMenu: stableRows(kitchenMenu),
    staffRequest: stableRows(staffRequest),
  })).digest('hex');
  return {
    schemaVersion: 4,
    eventId: clean(eventId, 120),
    syncedAt,
    checksum,
    guestCount,
    packOut,
    kitchenPackOut,
    kitchenMenu,
    staffRequest,
    sourceErrors: (Array.isArray(sourceErrors) ? sourceErrors : []).slice(0, 3),
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

const brandLogoParagraph = () => `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1463040" cy="636648"/><wp:docPr id="1" name="Olivier Cheng logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.svg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1463040" cy="636648"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const imageCell = (image, width) => {
  if (!image) return cell('', { width });
  const extent = 502920;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${extent}" cy="${extent}"/><wp:docPr id="${image.documentId}" name="${escapeXml(image.fileName)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image.documentId}" name="${escapeXml(image.fileName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent}" cy="${extent}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:tc>`;
};

const cell = (value, { bold = false, width = 0, shading = '', align = '' } = {}) => {
  const values = Array.isArray(value) ? value : [value];
  const contents = (values.length ? values : [''])
    .map((entry) => paragraph(entry, { bold, size: 18, after: 0, align }))
    .join('');
  return `<w:tc><w:tcPr>${width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : ''}${shading ? `<w:shd w:val="clear" w:fill="${shading}"/>` : ''}<w:vAlign w:val="top"/></w:tcPr>${contents}</w:tc>`;
};

const tableBorders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>';

const table = (headers, rows, widths) => `<w:tbl>
  <w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${tableBorders}</w:tblPr>
  <w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>
  ${headers.length ? `<w:tr>${headers.map((header, index) => cell(header, { bold: true, width: widths[index], shading: 'E7E6E6' })).join('')}</w:tr>` : ''}
  ${rows.map((row) => `<w:tr>${row.map((value, index) => cell(value, { width: widths[index] })).join('')}</w:tr>`).join('')}
</w:tbl>`;

const documentTitleRow = (title) => `<w:tbl>
  <w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="8000"/><w:gridCol w:w="2600"/></w:tblGrid>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>${paragraph(title, { bold: true, size: 36, after: 80 })}</w:tc>
    <w:tc><w:tcPr><w:tcW w:w="2600" w:type="dxa"/></w:tcPr>${paragraph('Revision', { bold: true, size: 28, align: 'right', after: 80 })}</w:tc>
  </w:tr>
</w:tbl>`;

const longDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return clean(value, 80);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(date);
};

const displayedEventNumber = (value) => {
  const text = clean(value, 120);
  const match = text.match(/\bE\d+\b/i);
  return match ? match[0].toUpperCase() : text;
};

const itemKey = (value) => clean(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const matchesAny = (value, patterns) => patterns.some((pattern) => pattern.test(value));

const packOutSection = (row) => {
  const name = itemKey(row?.itemName);
  const category = clean(row?.category, 160);
  const menuGroup = clean(row?.menuGroup, 160);
  if (category.toLowerCase() === 'staff' || menuGroup.toLowerCase() === 'staff') return 'STAFF ITEMS';
  if (matchesAny(name, [/milk/, /sweet and low/, /splenda/, /sugar cubes?/, /tea bags?/, /espresso/, /tea kettle/])) return 'COFFEE EQUIPMENT';
  if (matchesAny(name, [/\bpanna\b/, /pellegrino/])) return 'WATER';
  if (matchesAny(name, [/\bcoke\b/, /diet coke/, /ginger ale/, /ginger beer/, /club soda/, /\btonic\b/])) return 'SODA';
  if (matchesAny(name, [/juice/, /simple syrup/, /squeeze bottle 12 oz/, /quart container$/])) return 'JUICE';
  if (matchesAny(name, [/lime wheels?/, /lemon wheels?/, /whole limes?/, /whole lemons?/, /maraschino/, /martini olives?/, /whole oranges?/])) return 'GARNISH';
  if (matchesAny(name, [/\bstraws?\b/])) return 'ADDITIONAL';
  if (matchesAny(name, [/tray spray/, /roll of paper ?towels?/])) return 'CLEANING';
  if (matchesAny(name, [/wooden tray/, /taco insert/, /corner insert/, /white stones?/])) return 'TRAYS';
  if (matchesAny(name, [/cake stand/, /champagne bucket/])) return 'CAKE STAND';
  if (matchesAny(name, [/c folds?/, /dish soap/, /dish sponge/, /tray cleaning spray/, /microfiber cloths?/, /first aid kit$/])) return 'SANITATION KIT';
  if (category.toLowerCase() === 'disposable') return 'DISPOSABLE ITEMS';
  if (menuGroup.toLowerCase() === 'kitchen equipment') return 'KITCHEN EQUIPMENT';
  return category || menuGroup || 'UNASSIGNED';
};

const PACK_OUT_SECTION_ORDER = [
  'STAFF ITEMS', 'COFFEE EQUIPMENT', 'WATER', 'SODA', 'JUICE', 'GARNISH', 'ADDITIONAL',
  'CLEANING', 'TRAYS', 'CAKE STAND', 'KITCHEN EQUIPMENT', 'SANITATION KIT', 'DISPOSABLE ITEMS', 'UNASSIGNED',
];

const PACK_OUT_TEMPLATE = Object.freeze({
  'STAFF ITEMS': ['Paper plates', 'Plastic flatware', 'Paper cups', 'Staff water', 'First aid and grooming kits'],
  'COFFEE EQUIPMENT': ['Milk (Quart)', 'Skim Milk (Quart)', 'Almond Milk', 'Oat Milk', ['Sweet and Low /splenda', '1/2 pint combined'], 'Sugar Cubes', 'Assorted Tea Bags', 'Espresso Machine', ['Espresso Machine Pods', '1 box each kind'], 'Milk Steamer', 'Tea kettle'],
  WATER: ['Panna', 'Pellegrino'],
  SODA: ['Coke', 'Diet Coke', 'Ginger Ale', 'Ginger Beer', 'Club Soda', 'Tonic'],
  JUICE: ['Orange Juice', 'Grapefruit Juice', 'Cranberry Juice', 'Lemon Juice', 'Lime Juice', 'Simple Syrup - pint', 'Squeeze Bottle (12 oz)', 'Quart Container'],
  GARNISH: ['Lime Wheels', 'Lemon Wheels', 'Whole Limes', 'Whole Lemons', 'Maraschino Cherries', 'Martini Olives', 'Whole oranges'],
  ADDITIONAL: ['Straws'],
  CLEANING: ['Tray spray', 'Roll of papertowels'],
  TRAYS: ['Square Walnut wooden tray 14"X14"', 'Taco insert for square wood tray', 'Gold corner insert', 'Small white stones'],
  'CAKE STAND': ['CAKE STAND', 'Milano Stainless Steel Champagne Bucket'],
  'KITCHEN EQUIPMENT': ['Chef apron', 'Cutting Board', 'Knife- Serrated', 'Sheet pans- Half', 'Sheet pans- Full', 'Mixing Bowl- Small', 'Mixing Bowl- Medium', 'Spoons- Small', 'Spoons- Medium', 'Parchment paper', 'Pot- Small', 'Pot- Medium', 'Rondeau - Medium', 'Ice cream scoop', 'Ladles- 2 oz', 'Salt and pepper', 'Olive oil', 'Fish Spatula', 'Squeeze bottle', 'Whisk', 'Tongs', 'Rubber Spatula', 'Wooden spoon', 'Plastic teaspoons', 'Plastic tasting spoons'],
  'SANITATION KIT': ['C-folds', 'Dish soap', 'Dish sponge', 'Tray Cleaning spray', 'Microfiber cloths', 'First aid kit'],
  'DISPOSABLE ITEMS': ['Cocktail napkins', 'Clear recycle bags', 'Pastry bags', 'Garbage bags', 'Lug liners', 'Paper towels', 'Foil', 'Plastic wrap', 'Empty transfer tins- half', 'Empty transfer tins- full', ['Gloves- S, M, L', '1 of each'], 'Quart containers w/ lids', 'Pint containers w/ lids', 'Sani wipes'],
});

const templatedPackOutGroups = (rows, includeTemplate = true) => {
  const byName = new Map(rows.map((row) => [itemKey(row.itemName), row]));
  const consumed = new Set();
  const groups = new Map();
  if (includeTemplate) {
    Object.entries(PACK_OUT_TEMPLATE).forEach(([section, items]) => {
      groups.set(section, items.map((entry) => {
        const [name, templateNote = ''] = Array.isArray(entry) ? entry : [entry, ''];
        const matched = byName.get(itemKey(name));
        if (matched) consumed.add(itemKey(matched.itemName));
        return {
          itemName: name,
          quantity: matched?.quantity ?? null,
          notes: matched?.notes || templateNote,
        };
      }));
    });
  }
  rows.forEach((row) => {
    if (consumed.has(itemKey(row.itemName))) return;
    const section = packOutSection(row);
    const values = groups.get(section) || [];
    values.push(row);
    groups.set(section, values);
  });
  return groups;
};

export const packOutRenderedItemNames = (rows = [], includeTemplate = true) => [
  ...templatedPackOutGroups(
    (Array.isArray(rows) ? rows : []).filter((row) => clean(row?.menuGroup, 160).toLowerCase() !== 'standard'),
    includeTemplate
  ).values(),
].flat().map((row) => clean(row?.itemName, 300)).filter(Boolean);

const catereasePackOutTable = (groups, decorImages = []) => {
  const includePhotos = decorImages.length > 0;
  const imageByName = new Map(decorImages.map((image) => [itemKey(image.itemName), image]));
  const widths = includePhotos ? [2900, 700, 2800, 1000, 1000, 1700] : [3700, 700, 3500, 1100, 1100];
  const headers = ['Name', 'Qty', 'Notes/Comments', 'Delivered', 'Returned', ...(includePhotos ? ['Photo'] : [])];
  const header = `<w:tr>${headers.map((value, index) => cell(value, {
    bold: true,
    width: widths[index],
    shading: 'E7E6E6',
    align: 'center',
  })).join('')}</w:tr>`;
  const sectionRow = (name) => `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${widths.length}"/><w:tcW w:w="${widths.reduce((total, width) => total + width, 0)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(name, { bold: true, size: 20, align: 'center', after: 0 })}</w:tc></w:tr>`;
  const body = [...groups.entries()].map(([group, values]) => `${sectionRow(group.toUpperCase())}${values.map((row) => `<w:tr>${[
    { value: row.itemName, align: 'center' },
    { value: formatQuantity(row.quantity), align: 'center' },
    { value: row.notes || '', align: '' },
    { value: '', align: '' },
    { value: '', align: '' },
  ].map(({ value, align }, index) => cell(value, { width: widths[index], align })).join('')}${includePhotos ? imageCell(imageByName.get(itemKey(row.itemName)), widths[5]) : ''}</w:tr>`).join('')}`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${tableBorders}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header}${body}</w:tbl>`;
};

const packOutTable = (rows, decorImages = [], includeTemplate = true) => {
  const groups = templatedPackOutGroups(
    rows.filter((row) => clean(row?.menuGroup, 160).toLowerCase() !== 'standard'),
    includeTemplate
  );
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    const leftIndex = PACK_OUT_SECTION_ORDER.indexOf(left);
    const rightIndex = PACK_OUT_SECTION_ORDER.indexOf(right);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex) || left.localeCompare(right);
  });
  return catereasePackOutTable(new Map(orderedGroups), decorImages);
};

const formatQuantity = (value) => {
  if (value === '' || value === null || value === undefined) return '';
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

export const catereaseOperationalZoneKey = (row) => clean(row?.subEvent || row?.zoneName, 200).toLowerCase();

const operationalRows = (snapshot, type, zoneKey = '') => {
  const version = Number(snapshot?.schemaVersion) || 1;
  let rows;
  if (type === 'po') rows = (version >= 2 ? snapshot?.packOut : snapshot?.kitchenMenu) || [];
  if (type === 'kitchen_packout') {
    rows = (version >= 3 ? snapshot?.kitchenPackOut : version >= 2 ? snapshot?.kitchenMenu : snapshot?.packOut) || [];
  }
  if (type === 'staff_request') rows = snapshot?.staffRequest || [];
  if (['kitchen_menu', 'annotated_kitchen_menu'].includes(type) && version >= 3) {
    const derivedKitchenMenu = buildKitchenMenuRows(snapshot?.kitchenPackOut || []);
    rows = derivedKitchenMenu.length
      ? mergeKitchenMenuRows(derivedKitchenMenu, snapshot?.kitchenMenu || [])
      : snapshot?.kitchenMenu || [];
  }
  if (['kitchen_menu', 'annotated_kitchen_menu'].includes(type) && version < 3) {
    const legacyKitchenPackOut = (version >= 2 ? snapshot?.kitchenMenu : snapshot?.packOut) || [];
    rows = buildKitchenMenuRows(legacyKitchenPackOut);
  }
  const normalizedZoneKey = clean(zoneKey, 200).toLowerCase();
  return normalizedZoneKey
    ? (Array.isArray(rows) ? rows : []).filter((row) => catereaseOperationalZoneKey(row) === normalizedZoneKey)
    : (Array.isArray(rows) ? rows : []);
};

const kitchenMenuSections = (rows, recipes, includeAnnotations = false) => {
  const recipeIndex = buildExactRecipeMatchIndex(recipes);
  const preparedRows = rows.map((row) => {
    const match = resolveExactRecipeMatch(row?.itemName, recipeIndex);
    const recipe = match.status === 'matched' ? match.recipe : null;
    const dishKey = itemKey(row?.itemName);
    const comments = [row?.description, row?.notes]
      .map((value) => clean(catereaseRichTextToPlain(value), 12000))
      .filter((value, index, values) => value && itemKey(value) !== dishKey && values.indexOf(value) === index);
    const labels = [recipe?.instructions, recipe?.notes]
      .map((value) => clean(catereaseRichTextToPlain(value), 12000))
      .filter((value, index, values) => value && itemKey(value) !== dishKey && values.indexOf(value) === index);
    return {
      ...row,
      group: clean(row?.menuGroup || row?.category || row?.prepArea, 160) || 'Menu',
      itemName: clean(row?.itemName, 300) || 'Untitled dish',
      comments,
      labels: includeAnnotations ? labels : [],
    };
  });
  const isBeverage = (row) => /\b(?:bar|beverage|cocktail|wine|beer|liquor)\b/i.test([
    row?.menuGroup, row?.category, row?.prepArea,
  ].filter(Boolean).join(' '));
  const renderSection = (heading, values) => {
    const bodyRows = [];
    [...groupedRows(values, (row) => row.group).entries()].forEach(([group, grouped]) => {
      if (!['menu', 'unassigned', heading.toLowerCase()].includes(group.toLowerCase())) {
        bodyRows.push(['', group.toUpperCase(), '', '']);
      }
      grouped.forEach((row) => bodyRows.push([
        formatQuantity(row.quantity),
        row.itemName,
        row.comments,
        row.labels,
      ]));
    });
    return `${paragraph(heading, { bold: true, size: 28, before: 220, after: 80 })}${
      table(['Qty', 'Item', 'Comment', 'Label (OCC; Rentals)'], bodyRows, [570, 4580, 2825, 3105])
    }`;
  };
  const menuRows = preparedRows.filter((row) => !isBeverage(row));
  const beverageRows = preparedRows.filter(isBeverage);
  return `${renderSection('MENU', menuRows)}${beverageRows.length ? renderSection('BEVERAGE', beverageRows) : ''}`;
};

const kitchenStaffingSection = (event) => {
  const shifts = Array.isArray(event?.meta?.nowsta?.shifts) ? event.meta.nowsta.shifts : [];
  if (!shifts.length) return '';
  const uniform = clean(event?.meta?.nowsta?.uniform, 300);
  const rows = shifts.map((shift) => {
    const assigned = Array.isArray(shift?.workers) ? shift.workers.length : 0;
    const unfilled = Math.max(0, Number(shift?.unfilled) || 0);
    return [
      formatQuantity(assigned + unfilled),
      clean(shift?.position, 200),
      clean(shift?.startTime, 80),
      uniform,
      shift?.endTime ? `End: ${clean(shift.endTime, 80)}` : '',
    ];
  }).filter((row) => row[1]);
  if (!rows.length) return '';
  return `${paragraph('STAFFING INFO', { bold: true, size: 28, before: 220, after: 80 })}${
    table(['#', 'Position', 'Start', 'Uniform', 'Comments'], rows, [1000, 2150, 1100, 3950, 2400])
  }`;
};

const documentXml = ({ event, snapshot, type, recipes = [], includeBrandLogo = false, decorImages = [], includePackOutTemplate = true, zoneKey = '', zoneName = '' }) => {
  const isKitchenPackOut = type === 'kitchen_packout';
  const isStaffRequest = type === 'staff_request';
  const isKitchenMenu = ['kitchen_menu', 'annotated_kitchen_menu'].includes(type);
  const isAnnotatedKitchenMenu = type === 'annotated_kitchen_menu';
  const rows = operationalRows(snapshot, type, zoneKey);
  const title = isAnnotatedKitchenMenu ? 'ANNOTATED KITCHEN MENU' : isKitchenMenu ? 'KITCHEN MENU' : isKitchenPackOut ? 'KITCHEN PACK OUT' : isStaffRequest ? 'STAFF REQUEST' : 'PACK OUT';
  const groups = groupedRows(rows, (row) => (
    isKitchenPackOut
      ? row.station || row.prepArea
      : row.menuGroup || row.category || row.prepArea
  ));
  const sections = isKitchenMenu ? kitchenMenuSections(rows, recipes, isAnnotatedKitchenMenu) : isStaffRequest
    ? table(['#', 'Position', 'Start', 'End', 'Uniform', 'Comments'], rows.map((row) => [
      formatQuantity(row.required), row.position, row.startTime, row.endTime, row.uniform, row.comments,
    ]), [700, 2200, 1300, 1300, 2600, 2700])
    : isKitchenPackOut ? catereasePackOutTable(new Map([...groups.entries()].map(([group, values]) => [
      group,
      values.map((row) => ({
        itemName: row.itemName,
        quantity: row.quantity,
        notes: [row.unit, row.prepArea].filter(Boolean).join(' · '),
      })),
    ]))) : packOutTable(rows, decorImages, includePackOutTemplate);
  const parsedEventGuestCount = Number(event?.meta?.guestCount);
  const legacyGuestRow = rows.find((row) => itemKey(row?.itemName) === 'food' && clean(row?.menuGroup).toLowerCase() === 'standard');
  const parsedSnapshotGuestCount = Number(snapshot?.guestCount ?? legacyGuestRow?.quantity);
  const guestCount = Number.isFinite(parsedEventGuestCount) && parsedEventGuestCount > 0
    ? parsedEventGuestCount
    : Number.isFinite(parsedSnapshotGuestCount) && parsedSnapshotGuestCount > 0 ? parsedSnapshotGuestCount : '';
  const eventTiming = event?.meta?.eventTime || event?.meta?.nowsta?.eventTime || '';
  const deliveryTime = event?.meta?.deliveryTime || '';
  const printableZoneName = clean(zoneName, 200);
  const zoneHeading = printableZoneName && printableZoneName.toLowerCase() !== 'main'
    ? paragraph(printableZoneName, { bold: true, size: 24, align: 'center', after: 120 })
    : '';
  const eventDetailsTable = table([], [
    [`Event: ${event?.title || 'Event'}`, `Event Date: ${longDate(event?.date)}`],
    [`Sales Rep: ${event?.meta?.salesRep || ''}`, `Event Timing: ${eventTiming}`],
    [`Guests: ${guestCount}`, `Delivery Time: ${deliveryTime}`],
    [`Event Number: ${displayedEventNumber(event?.externalId || snapshot?.eventId || '')}`, `Date PO Modified: ${new Intl.DateTimeFormat('en-US').format(new Date())}`],
  ], [5300, 5300]);
  const documentHeader = isKitchenMenu ? `${documentTitleRow(title)}${zoneHeading}${table([], [
    [`Event Name: ${event?.title || 'Event'}`, `Event Timing: ${eventTiming}`],
    [`Date: ${longDate(event?.date)}`, `Staff Arrival on Site: ${event?.meta?.staffArrivalTime || ''}`],
    [`Guest Count: ${guestCount}`, `Sales Rep: ${event?.meta?.salesRep || ''}`],
    [`Client: ${event?.client || ''}`, `Site Contact: ${event?.meta?.siteContact || ''}`],
    [`Location: ${event?.meta?.venue || event?.meta?.nowsta?.venue || ''}`, `Last Modified: ${new Intl.DateTimeFormat('en-US').format(new Date(event?.updatedAt || Date.now()))}`],
    [`Address: ${event?.meta?.address || event?.meta?.nowsta?.address || ''}`, `Service Entrance: ${event?.meta?.serviceEntrance || ''}`],
    [`Client Notes: ${event?.meta?.clientNotes || ''}`, `Meeting Point: ${event?.meta?.meetingPoint || ''}`],
    [`Venue Notes: ${event?.meta?.venueNotes || ''}`, `Event Number: ${displayedEventNumber(event?.externalId || snapshot?.eventId || '')}`],
    [`Allergen/Restrictions: ${event?.meta?.allergens || event?.meta?.restrictions || ''}`, ''],
  ], [5300, 5300])}` : isStaffRequest
    ? `${paragraph(title, { bold: true, size: 30, align: 'center', after: 120 })}${zoneHeading}${eventDetailsTable}`
    : `${paragraph('Revision', { bold: true, size: 28, align: 'right', after: 80 })}${paragraph(title, { bold: true, size: 30, align: 'center', after: 120 })}${zoneHeading}${eventDetailsTable}`;
  const documentFooterSections = isKitchenMenu ? kitchenStaffingSection(event) : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  ${includeBrandLogo ? brandLogoParagraph() : ''}
  ${documentHeader}
  ${sections || paragraph('No rows returned by Caterease.', { size: 20, before: 240 })}
  ${documentFooterSections}
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="615" w:right="765" w:bottom="600" w:left="810" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
};

export const renderCatereaseOperationalDocx = async ({
  event,
  snapshot,
  type,
  recipes = [],
  brandLogoSvg = null,
  decorImages = [],
  includePackOutTemplate = true,
  zoneKey = '',
  zoneName = '',
}) => {
  const includeBrandLogo = Buffer.isBuffer(brandLogoSvg) && brandLogoSvg.length > 0;
  const embeddedDecorImages = (Array.isArray(decorImages) ? decorImages : [])
    .filter((image) => Buffer.isBuffer(image?.buffer) && image.buffer.length > 0)
    .slice(0, 40)
    .map((image, index) => ({
      ...image,
      documentId: index + 2,
      relationshipId: `rId${index + 3}`,
      fileName: `decor-${index + 1}.${image.extension === 'png' ? 'png' : 'jpg'}`,
    }));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${includeBrandLogo ? '<Default Extension="svg" ContentType="image/svg+xml"/>' : ''}${embeddedDecorImages.length ? '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const word = zip.folder('word');
  word.file('document.xml', documentXml({
    event,
    snapshot,
    type,
    recipes,
    includeBrandLogo,
    decorImages: embeddedDecorImages,
    includePackOutTemplate,
    zoneKey,
    zoneName,
  }));
  word.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Avenir Medium" w:hAnsi="Avenir Medium"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`);
  if (includeBrandLogo) word.folder('media').file('logo.svg', brandLogoSvg);
  embeddedDecorImages.forEach((image) => word.folder('media').file(image.fileName, image.buffer));
  word.folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${includeBrandLogo ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.svg"/>' : ''}${embeddedDecorImages.map((image) => `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`).join('')}</Relationships>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
