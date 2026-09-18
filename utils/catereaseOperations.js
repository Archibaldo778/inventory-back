import crypto from 'node:crypto';
import JSZip from 'jszip';
import { catereaseRichTextToPlain } from './catereaseKitchen.js';
import { buildExactRecipeMatchIndex, resolveExactRecipeMatch } from './kitchenRecipeMatching.js';
import {
  buildCatereasePackOutTemplateSummaries,
  catereaseKitchenPackOutDocumentGroups,
  catereaseOperationalTemplateRows,
  catereasePackOutTemplate,
  catereasePackOutTemplateRows,
} from './catereasePackOutTemplates.js';

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
const nullableBooleanValue = (value) => (
  value === '' || value === null || value === undefined ? null : booleanValue(value)
);
const first = (row, keys) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return '';
};
const catereaseTimeValue = (value) => {
  const normalized = clean(value, 80);
  if (!normalized || /^\s*:\s*M\s*$/i.test(normalized)) return '';
  const dateTime = normalized.match(/T(\d{1,2}:\d{2}(?::\d{2})?)/i);
  return dateTime ? dateTime[1] : normalized;
};
const fallbackSourceId = (row) => `row-${crypto.createHash('sha1').update(JSON.stringify(row || {})).digest('hex').slice(0, 16)}`;
const operationalZoneIdentity = (row) => [
  clean(row?.subEvent, 120).toLowerCase(),
  clean(row?.zoneName, 200).toLowerCase(),
].filter(Boolean).join('|');

export const normalizeCatereasePackOutRows = (rows = []) => {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .slice(0, 10000)
    .map((row, sourceIndex) => ({
    sourceId: clean(first(row, ['UID', 'FdSvNum', 'FSNum', 'ItemNum', 'ItemID', 'ID']), 120) || fallbackSourceId(row),
    foodServiceId: clean(first(row, ['FdSvNum', 'FSNum']), 120),
    itemId: clean(first(row, ['ItemNum', 'ItemID']), 120),
    itemName: clean(first(row, ['ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    prepArea: clean(first(row, ['PrepArea', 'FSPrepArea']), 160),
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    zoneName: clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200),
    category: clean(first(row, ['Category']), 160),
    fsType: clean(first(row, ['FSType', 'Type', 'ItemType']), 160),
    menuGroup: clean(first(row, ['MenuGroup', 'FSCategory', 'GroupName']), 160),
    sortOrder: numberOrNull(first(row, ['NSort'])),
    revised: clean(first(row, ['Revised']), 80),
    sourceIndex,
    ...(first(row, ['UseRecipe']) !== ''
      ? { useRecipe: nullableBooleanValue(first(row, ['UseRecipe'])) }
      : {}),
      notes: clean(catereaseRichTextToPlain(first(row, ['Notes', 'Comment', 'Description', 'Instructions'])), 1000),
    }));
  const itemNames = new Set(normalizedRows.map((row) => itemKey(row.itemName)).filter(Boolean));
  const groupOrder = new Map();
  normalizedRows.forEach((row) => {
    const key = clean(row.subEvent, 120).toLowerCase();
    if (!groupOrder.has(key)) groupOrder.set(key, groupOrder.size);
  });
  return normalizedRows
    .sort((left, right) => {
      const groupDifference = groupOrder.get(clean(left.subEvent, 120).toLowerCase())
        - groupOrder.get(clean(right.subEvent, 120).toLowerCase());
      if (groupDifference) return groupDifference;
      const leftHasSort = Number.isFinite(left.sortOrder);
      const rightHasSort = Number.isFinite(right.sortOrder);
      if (leftHasSort && rightHasSort && left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      if (leftHasSort !== rightHasSort) return leftHasSort ? -1 : 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map((row) => {
      const { sourceIndex: _sourceIndex, ...normalizedRow } = row;
      const nameKey = itemKey(row.itemName);
      const notesKey = itemKey(row.notes);
      const redundantDescription = notesKey && (
        notesKey === nameKey
        || itemNames.has(notesKey)
        || (notesKey.length >= 4 && nameKey.startsWith(`${notesKey} `))
        || ['garnish', 'specialty cocktail'].includes(notesKey)
      );
      return { ...normalizedRow, notes: redundantDescription ? '' : row.notes };
    })
    .filter((row) => row.itemName && row.menuGroup.toLowerCase() !== 'standard');
};

export const normalizeCatereaseKitchenPackOutRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    sourceId: clean(first(row, ['UID', 'ReqItemNum', 'RINum', 'ItemNum', 'ID']), 120) || fallbackSourceId(row),
    foodServiceId: clean(first(row, ['FdSvNum', 'FSNum']), 120),
    itemName: clean(first(row, ['OTFItemName', 'ItemName', 'Name', 'Title']), 300),
    quantity: numberOrNull(first(row, ['Qty', 'Quantity'])),
    unit: clean(first(row, ['Unit', 'DUnit']), 80),
    purchaseUnit: clean(first(row, ['PUnit', 'PurchaseUnit']), 80),
    quantityPerPurchaseUnit: numberOrNull(first(row, ['QtyPerPUnit', 'PUnitQty'])),
    prepArea: clean(first(row, ['FSPrepArea', 'PrepArea']), 160),
    station: clean(first(row, ['FSName', 'FoodServiceName']), 240),
    category: clean(first(row, ['Category']), 160),
    fsType: clean(first(row, ['FSType', 'FoodServiceType']), 160),
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

const normalizedItemText = (value) => clean(value, 12000)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const isKitchenMenuSectionHeading = ({ itemName, quantity, description, notes }) => {
  const name = clean(itemName, 300);
  if (!name || numberOrNull(quantity) !== 0) return false;
  const letters = name.replace(/[^A-Za-z]+/g, '');
  if (!letters || letters !== letters.toUpperCase()) return false;
  const nameKey = normalizedItemText(name);
  const hasDistinctDetails = [description, notes]
    .map(normalizedItemText)
    .some((value) => value && value !== nameKey);
  return !hasDistinctDetails;
};

export const buildKitchenMenuRows = (kitchenPackOutRows = []) => {
  const dishes = new Map();
  (Array.isArray(kitchenPackOutRows) ? kitchenPackOutRows : []).forEach((row) => {
    const name = clean(row?.station, 300);
    if (isKitchenMenuNoise(name)) return;
    const zoneName = clean(row?.zoneName, 200);
    const subEvent = clean(row?.subEvent, 120);
    const zoneKey = operationalZoneIdentity({ subEvent, zoneName });
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
  const currentSectionBySubEvent = new Map();
  (Array.isArray(rows) ? rows : []).slice(0, 10000).forEach((row) => {
    const itemName = clean(first(row, ['ItemName', 'Name', 'Title']), 300);
    const subEvent = clean(first(row, ['SubEvtNum', 'SubEvent']), 120);
    const zoneName = clean(first(row, ['SEDescription', 'Room', 'SubEventName']), 200);
    const zoneIdentity = operationalZoneIdentity({ subEvent, zoneName }) || '__main__';
    const quantity = numberOrNull(first(row, ['Qty', 'Quantity', 'Servings', 'RServings']));
    const description = clean(catereaseRichTextToPlain(first(row, ['Description', 'UseDesc'])), 12000);
    const notes = clean(catereaseRichTextToPlain(first(row, ['Comment', 'Notes'])), 12000);
    if (isKitchenMenuSectionHeading({ itemName, quantity, description, notes })) {
      currentSectionBySubEvent.set(zoneIdentity, itemName);
      return;
    }
    const key = `${operationalZoneIdentity({ subEvent, zoneName })}|${itemName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (!itemName || dishes.has(key)) return;
    dishes.set(key, {
      sourceId: clean(first(row, ['UID', 'FdSvNum', 'FSNum', 'ItemNum', 'ItemID', 'ID']), 120) || fallbackSourceId(row),
      itemName,
      quantity,
      unit: clean(first(row, ['Unit']), 80),
      prepArea: clean(first(row, ['PrepArea', 'FSPrepArea']), 160),
      subEvent,
      zoneName,
      category: clean(first(row, ['Category', 'FSCategory']), 160),
      fsType: clean(first(row, ['FSType', 'Type', 'ItemType']), 160),
      menuGroup: currentSectionBySubEvent.get(zoneIdentity)
        || clean(first(row, ['MenuGroup', 'FSCategory', 'GroupName']), 160),
      description,
      notes,
    });
  });
  return [...dishes.values()];
};

const mergeKitchenMenuRows = (derivedRows = [], directRows = []) => {
  const rowKey = (row) => `${operationalZoneIdentity(row)}|${normalizedItemText(row?.itemName)}`;
  const derivedByName = new Map();
  derivedRows.forEach((row) => {
    const key = rowKey(row);
    if (key && !derivedByName.has(key)) derivedByName.set(key, row);
  });
  const mergedKeys = new Set();
  const merged = directRows.map((direct) => {
    const key = rowKey(direct);
    const row = derivedByName.get(key);
    mergedKeys.add(key);
    if (!row) return direct;
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
  derivedRows.forEach((row) => {
    if (!mergedKeys.has(rowKey(row))) merged.push(row);
  });
  return merged;
};

const stableRows = (rows) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const normalizeCatereaseSubEventRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .slice(0, 10000)
  .map((row) => ({
    subEvent: clean(first(row, ['SubEvtNum', 'SubEvent']), 120),
    description: clean(first(row, ['Description', 'SEDescription', 'SubEventName']), 200),
    room: clean(first(row, ['Room']), 200),
    serviceDate: clean(first(row, ['SEvtDate', 'EventDate']), 40),
    startTime: clean(first(row, ['StartTime']), 80),
    endTime: clean(first(row, ['EndTime']), 80),
  }))
  .filter((row) => row.subEvent);

const applySubEventNames = (rows = [], zoneNameBySubEvent = new Map()) => rows.map((row) => ({
  ...row,
  zoneName: zoneNameBySubEvent.get(clean(row?.subEvent, 120).toLowerCase()) || row?.zoneName || '',
}));

const attachRequiredItemSubEvents = (requiredItems = [], foodService = []) => {
  const zoneByFoodServiceId = new Map();
  const zonesByFoodServiceName = new Map();
  foodService.forEach((row) => {
    const nameKey = clean(row?.itemName, 300).toLowerCase();
    const identity = operationalZoneIdentity(row);
    const foodServiceDetails = {
      subEvent: row.subEvent || '',
      zoneName: row.zoneName || '',
      fsType: row.fsType || '',
      category: row.category || '',
    };
    if (row.foodServiceId) {
      zoneByFoodServiceId.set(clean(row.foodServiceId, 120).toLowerCase(), foodServiceDetails);
    }
    if (!nameKey || !identity || !row?.subEvent) return;
    const matches = zonesByFoodServiceName.get(nameKey) || new Map();
    matches.set(identity, foodServiceDetails);
    zonesByFoodServiceName.set(nameKey, matches);
  });
  return requiredItems.map((row) => {
    const exactZone = zoneByFoodServiceId.get(clean(row?.foodServiceId, 120).toLowerCase());
    // Event-required-item rows may carry the event's generic SubEvtNum rather
    // than the sub-event that owns their parent food-service row. FdSvNum is
    // the structural parent reference and must win whenever it is available.
    if (exactZone) {
      return {
        ...row,
        subEvent: exactZone.subEvent || row.subEvent,
        zoneName: exactZone.zoneName || row.zoneName,
        fsType: row.fsType || exactZone.fsType,
        category: row.category || exactZone.category,
      };
    }
    if (row?.subEvent) return row;
    const matches = zonesByFoodServiceName.get(clean(row?.station, 300).toLowerCase());
    if (!matches || matches.size !== 1) return row;
    const zone = [...matches.values()][0];
    return {
      ...row,
      subEvent: zone.subEvent,
      zoneName: zone.zoneName || row.zoneName,
      fsType: row.fsType || zone.fsType,
      category: row.category || zone.category,
    };
  });
};

const kitchenPackOutKnownRouteKind = (value) => {
  const text = clean(value, 300).toLowerCase();
  if (/green\s*room|greenroom/.test(text)) return 'greenroom';
  if (/\b(?:hds?|hors\s*d['’]?oeuvres?)\b/.test(text)) return 'hds';
  if (/dinner\s*kitchen|seated\s*dinner/.test(text)) return 'dinner';
  if (/ice\s*cream|soft\s*serve/.test(text)) return 'ice-cream';
  if (/vendor/.test(text)) return 'vendor-meal';
  if (/dessert/.test(text)) return 'dessert-station';
  if (/staff\s*(?:holding|meal)/.test(text)) return 'staff-meal';
  if (/beverage|bar\b/.test(text)) return 'beverage';
  return '';
};

const kitchenPackOutRouteKind = (value, routes = []) => {
  const knownKind = kitchenPackOutKnownRouteKind(value);
  if (knownKind) return knownKind;
  const valueKey = itemKey(value);
  if (!valueKey) return '';
  const exactRoute = routes.find((route) => route.matchKey === valueKey);
  if (exactRoute) return exactRoute.kind;
  const ignored = new Set(['pack', 'out', 'kitchen', 'station', 'service', 'meal', 'menu']);
  const valueTokens = new Set(valueKey.split(' ').filter((token) => token && !ignored.has(token)));
  if (!valueTokens.size) return '';
  let bestRoute = null;
  let bestScore = 0;
  routes.forEach((route) => {
    const routeTokens = new Set(itemKey(route.matchKey).split(' ').filter((token) => token && !ignored.has(token)));
    if (!routeTokens.size) return;
    const overlap = [...valueTokens].filter((token) => routeTokens.has(token)).length;
    const score = overlap / Math.max(valueTokens.size, routeTokens.size);
    if (score > bestScore) {
      bestScore = score;
      bestRoute = route;
    }
  });
  return bestScore >= 0.5 ? bestRoute?.kind || '' : '';
};

const kitchenPackOutRouteLabel = (part, kind) => {
  const text = clean(part, 200);
  if (kind === 'hds') return 'HDs';
  if (kind === 'greenroom') return 'Greenroom';
  if (kind === 'vendor-meal') return 'Vendor Meal';
  if (kind === 'ice-cream') return 'Ice Cream';
  if (kind === 'dessert-station') return 'Dessert Station';
  if (kind === 'dinner') {
    const number = text.match(/#?\s*(\d+)\s*$/)?.[1];
    return `Seated Dinner${number ? ` ${number}` : ''}`;
  }
  return text;
};

const kitchenPackOutRouteDefinitions = (foodService = []) => {
  const routes = [];
  const seen = new Set();
  const add = (label, kind, sourceSubEvent = '', matchKey = '') => {
    if (!kind || ['beverage', 'staff-meal'].includes(kind)) return;
    const baseKey = kind === 'dinner'
      ? `${kind}-${clean(label, 80).match(/\d+/)?.[0] || routes.filter((route) => route.kind === kind).length + 1}`
      : kind;
    let key = baseKey;
    let occurrence = 2;
    while (seen.has(key)) {
      key = `${baseKey}-${occurrence}`;
      occurrence += 1;
    }
    seen.add(key);
    const safeKey = itemKey(key).replace(/\s+/g, '-');
    routes.push({ zoneKey: `kpo-route:${safeKey}`, zoneName: label, kind, sourceSubEvent, matchKey: matchKey || itemKey(label) });
  };

  const packOutZones = new Map();
  (Array.isArray(foodService) ? foodService : []).forEach((row) => {
    const zoneName = clean(row?.zoneName, 200);
    if (!/^pack\s*out\s*[-–—:]/i.test(zoneName)) return;
    const identity = operationalZoneIdentity(row);
    if (!packOutZones.has(identity)) packOutZones.set(identity, row);
  });
  packOutZones.forEach((row) => {
    const description = clean(row.zoneName, 200).replace(/^pack\s*out\s*[-–—:]\s*/i, '');
    description.split(/\s*&\s*/).map((part) => clean(part, 120)).filter(Boolean).forEach((part) => {
      const knownKind = kitchenPackOutKnownRouteKind(part);
      const kind = knownKind || `subevent:${itemKey(part)}`;
      add(kitchenPackOutRouteLabel(part, knownKind || kind), kind, clean(row.subEvent, 120), itemKey(part));
    });
  });
  return routes;
};

const kitchenMenuRouteByFoodServiceId = (foodService = [], routes = []) => {
  const routeById = new Map();
  const menuRows = (Array.isArray(foodService) ? foodService : [])
    .filter((row) => !/\b(?:invoice|pack\s*out)\b/i.test(clean(row?.zoneName, 200)))
    .sort((left, right) => (Number(left?.sortOrder) || 0) - (Number(right?.sortOrder) || 0));
  let currentKind = '';
  menuRows.forEach((row) => {
    const itemName = clean(row?.itemName, 300);
    const letters = itemName.replace(/[^A-Za-z]+/g, '');
    const isHeading = letters && letters === letters.toUpperCase();
    const nextKind = isHeading ? kitchenPackOutRouteKind(itemName, routes) : '';
    if (nextKind) currentKind = nextKind;
    else if (/^beverages?$/i.test(itemName)) currentKind = '';
    const id = clean(row?.foodServiceId, 120).toLowerCase();
    if (id && currentKind) routeById.set(id, currentKind);
  });
  return routeById;
};

const buildKitchenPackOutDocuments = (snapshot, rows = []) => {
  const sourceValues = Array.isArray(rows) ? rows : [];
  if (!sourceValues.length) return [];
  const routes = kitchenPackOutRouteDefinitions(snapshot?.foodService || snapshot?.packOut || []);
  const routeByFoodServiceId = kitchenMenuRouteByFoodServiceId(snapshot?.foodService || snapshot?.packOut || [], routes);
  if (!routes.some((route) => route.kind === 'dessert-station')
    && [...routeByFoodServiceId.values()].includes('dessert-station')) {
    routes.push({ zoneKey: 'kpo-route:dessert-station', zoneName: 'Dessert Station', kind: 'dessert-station', sourceSubEvent: '' });
  }
  const representedIds = new Set(sourceValues.map((row) => clean(row?.foodServiceId, 120).toLowerCase()).filter(Boolean));
  const routedFoodRows = (Array.isArray(snapshot?.foodService) ? snapshot.foodService : snapshot?.packOut || [])
    .filter((row) => clean(row?.fsType, 80).toLowerCase() === 'food')
    .filter((row) => {
      const id = clean(row?.foodServiceId, 120).toLowerCase();
      const kind = routeByFoodServiceId.get(id);
      return id && kind && !['beverage', 'staff-meal'].includes(kind)
        && !representedIds.has(id)
        && kitchenPackOutRouteKind(row?.itemName, routes) !== kind
        && !/^\*\*|\b(?:note|rental needs)\b/i.test(clean(row?.itemName, 300));
    })
    .map((row) => ({ ...row, station: row.itemName, topLevelFoodService: true }));
  const values = [...sourceValues, ...routedFoodRows];
  const dinnerRoutes = routes.filter((route) => route.kind === 'dinner');
  const documents = [{ zoneKey: 'kpo-route:main', zoneName: 'Main', rows: values }];
  routes.forEach((route) => {
    const routeRows = values.filter((row) => {
      const kind = routeByFoodServiceId.get(clean(row?.foodServiceId, 120).toLowerCase())
        || kitchenPackOutRouteKind(row?.menuGroup, routes)
        || kitchenPackOutRouteKind(row?.station, routes);
      if (kind === 'staff-meal') return route.kind === 'dinner' && route === dinnerRoutes.at(-1);
      return kind === route.kind;
    });
    if (routeRows.length) documents.push({ ...route, rows: routeRows });
  });
  return documents;
};

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
  eventRow = null,
  packOutRows = [],
  kitchenPackOutRows = [],
  kitchenMenuRows,
  staffRequestRows = [],
  subEventRows = [],
  printTemplateRows,
  sourceErrors = [],
  syncedAt = new Date(),
} = {}) => {
  const guestRow = (Array.isArray(packOutRows) ? packOutRows : []).find((row) => (
    clean(first(row, ['ItemName', 'Name', 'Title'])).toLowerCase() === 'food'
    && clean(first(row, ['MenuGroup', 'GroupName'])).toLowerCase() === 'standard'
  ));
  const eventGuestCount = catereaseOperationalGuestCount(eventRow ? [eventRow] : []);
  const guestCount = eventGuestCount ?? catereaseOperationalGuestCount(
    packOutRows,
    first(guestRow, ['Qty', 'Quantity'])
  );
  const salesRep = clean(first(eventRow, ['SalesRep', 'SalesRepresentative', 'SalesPerson']), 200);
  const client = clean(first(eventRow, ['Client', 'Organization']), 300);
  const eventAddress = [
    clean(first(eventRow, ['Address1', 'Address']), 300),
    [clean(first(eventRow, ['City']), 120), clean(first(eventRow, ['StProv', 'State']), 80)].filter(Boolean).join(', '),
    clean(first(eventRow, ['Postal', 'PostalCode', 'Zip']), 40),
  ].filter(Boolean).join(' ').replace(/,\s+([^,]+)\s+(\S+)$/, ', $1 $2');
  const eventStatus = clean(first(eventRow, ['Status']), 120);
  const eventType = clean(first(eventRow, ['Category', 'EventType']), 200);
  const serviceStartTime = clean(first(eventRow, ['Extra13']), 80);
  const serviceEndTime = clean(first(eventRow, ['Extra14']), 80);
  const deliveryTime = clean(first(eventRow, ['Extra10', 'Extra11']), 80);
  const eventRevised = clean(first(eventRow, ['Revised']), 80);
  const subEvents = normalizeCatereaseSubEventRows(subEventRows);
  const timedSubEvents = subEvents.filter((row) => row.startTime || row.endTime);
  const timedEvent = timedSubEvents.find((row) => /\binvoice\b/i.test(row.description))
    || timedSubEvents.find((row) => !/\b(?:staff(?:ing)?|menu|pack\s*out)\b/i.test(row.description))
    // Some Caterease events only expose a Staffing or Pack Out sub-event. Its time is
    // still better than silently showing no event time, and EvtFrom/EvtTo remain the
    // final event-level fallback when there are no timed sub-events at all.
    || timedSubEvents[0];
  const eventStartTime = catereaseTimeValue(serviceStartTime)
    || catereaseTimeValue(timedEvent?.startTime)
    || catereaseTimeValue(first(eventRow, ['EvtFrom', 'EventStartTime', 'StartTime']));
  const eventEndTime = catereaseTimeValue(serviceEndTime)
    || catereaseTimeValue(timedEvent?.endTime)
    || catereaseTimeValue(first(eventRow, ['EvtTo', 'EventEndTime', 'EndTime']));
  const zoneNameBySubEvent = new Map(subEvents.map((row) => [
    clean(row.subEvent, 120).toLowerCase(),
    row.description || row.room,
  ]).filter(([, name]) => name));
  const packOut = applySubEventNames(normalizeCatereasePackOutRows(packOutRows), zoneNameBySubEvent);
  const kitchenPackOut = attachRequiredItemSubEvents(
    normalizeCatereaseKitchenPackOutRows(kitchenPackOutRows),
    packOut
  );
  const directKitchenMenu = applySubEventNames(normalizeCatereaseKitchenMenuDishRows(kitchenMenuRows), zoneNameBySubEvent)
    .filter((row) => !/\b(?:pack\s*out|invoice)\b/i.test(row.zoneName));
  const derivedKitchenMenu = buildKitchenMenuRows(kitchenPackOut);
  const kitchenMenu = derivedKitchenMenu.length
    ? mergeKitchenMenuRows(derivedKitchenMenu, directKitchenMenu)
    : directKitchenMenu;
  const packOutTemplates = buildCatereasePackOutTemplateSummaries(kitchenPackOut, printTemplateRows, packOut, kitchenMenu);
  const fallbackZoneNameBySubEvent = new Map(
    [...packOut, ...kitchenPackOut, ...directKitchenMenu]
      .filter((row) => row?.subEvent && row?.zoneName)
      .map((row) => [clean(row.subEvent, 120).toLowerCase(), clean(row.zoneName, 200)])
  );
  const staffRequest = normalizeCatereaseStaffRequestRows(staffRequestRows).map((row) => ({
    ...row,
    zoneName: row.zoneName
      || zoneNameBySubEvent.get(clean(row.subEvent, 120).toLowerCase())
      || fallbackZoneNameBySubEvent.get(clean(row.subEvent, 120).toLowerCase())
      || '',
  }));
  const operationalSnapshot = {
    requiredItems: kitchenPackOut,
    kitchenPackOut,
    foodService: packOut,
    packOut,
    kitchenMenu,
    packOutTemplates,
  };
  const kitchenPackOutTemplate = packOutTemplates.find((template) => (
    template.documentType === 'kitchen_packout'
    && template.operationalVisible !== false
    && template.supported !== false
  ));
  const kitchenPackOutDocuments = kitchenPackOutTemplate
    ? buildKitchenPackOutDocuments(
      operationalSnapshot,
      catereaseOperationalTemplateRows(operationalSnapshot, kitchenPackOutTemplate.key, packOutTemplates)
    )
    : [];
  const checksum = crypto.createHash('sha256').update(JSON.stringify({
    eventId: clean(eventId, 120),
    guestCount,
    salesRep,
    client,
    eventAddress,
    eventStatus,
    eventType,
    serviceStartTime,
    serviceEndTime,
    deliveryTime,
    eventRevised,
    eventStartTime,
    eventEndTime,
    packOut: stableRows(packOut),
    kitchenPackOut: stableRows(kitchenPackOut),
    kitchenMenu: stableRows(kitchenMenu),
    staffRequest: stableRows(staffRequest),
    packOutTemplates,
    kitchenPackOutDocuments,
  })).digest('hex');
  return {
    schemaVersion: 24,
    eventId: clean(eventId, 120),
    syncedAt,
    checksum,
    guestCount,
    salesRep,
    client,
    eventAddress,
    eventStatus,
    eventType,
    serviceStartTime,
    serviceEndTime,
    deliveryTime,
    eventRevised,
    eventStartTime,
    eventEndTime,
    packOut,
    kitchenPackOut,
    requiredItems: kitchenPackOut,
    foodService: packOut,
    subEvents,
    packOutTemplates,
    kitchenPackOutDocuments,
    kitchenMenu,
    staffRequest,
    sourceErrors: (Array.isArray(sourceErrors) ? sourceErrors : []).slice(0, 8),
  };
};

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const textRun = (value, { bold = false, size = 20, color = '', font = 'Avenir Medium' } = {}) => (
  `<w:r><w:rPr><w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:cs="${escapeXml(font)}"/>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${escapeXml(color)}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`
);

const paragraph = (value, options = {}) => {
  const { bold = false, size = 20, color = '', align = '', before = 0, after = 0 } = options;
  return `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:before="${before}" w:after="${after}"/></w:pPr>${textRun(value, { bold, size, color })}</w:p>`;
};

const richParagraph = (runs, options = {}) => {
  const { align = '', before = 0, after = 0 } = options;
  return `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:before="${before}" w:after="${after}"/></w:pPr>${runs.map((run) => textRun(run.value, run)).join('')}</w:p>`;
};

const eventNameCell = (label, value) => ({
  runs: [
    { value: label, bold: true, size: 28, color: 'FF0000' },
    { value: value || 'Event', bold: true, size: 28, color: 'FF0000' },
  ],
});

const highlightedValueCell = (label, value, { valueSize = 20 } = {}) => ({
  runs: [
    { value: label, bold: true, size: 20 },
    { value: value || '', bold: true, size: valueSize, color: 'FF0000' },
  ],
});

const labeledValueCell = (label, value, { valueBold = false } = {}) => ({
  runs: [
    { value: label, bold: true, size: 20 },
    { value: value || '', bold: valueBold, size: 20 },
  ],
});

const brandLogoParagraph = () => `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1463040" cy="636648"/><wp:docPr id="1" name="Olivier Cheng logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.svg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1463040" cy="636648"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const imageCell = (image, width) => {
  if (!image) return cell('', { width });
  const extent = 502920;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${extent}" cy="${extent}"/><wp:docPr id="${image.documentId}" name="${escapeXml(image.fileName)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${image.documentId}" name="${escapeXml(image.fileName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent}" cy="${extent}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:tc>`;
};

const cell = (value, { bold = false, width = 0, shading = '', align = '' } = {}) => {
  const values = Array.isArray(value) ? value : [value];
  const contents = (values.length ? values : [''])
    .map((entry) => (Array.isArray(entry?.runs)
      ? richParagraph(entry.runs, { after: 0, align })
      : paragraph(entry, { bold, size: 20, after: 0, align })))
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

const shortDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return clean(value, 80);
  return `${match[2]}/${match[3]}/${match[1]}`;
};

const displayedEventNumber = (value) => {
  const text = clean(value, 120);
  const match = text.match(/\bE\d+\b/i);
  return match ? match[0].toUpperCase() : text;
};

const catereaseModifiedDateTime = (value) => {
  const raw = clean(value, 80);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return raw;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const displayHour = hour % 12 || 12;
  const suffix = hour >= 12 ? 'pm' : 'am';
  return `${Number(match[2])}/${Number(match[3])}/${match[1]} (${displayHour}:${String(minute).padStart(2, '0')} ${suffix})`;
};

const latestCatereaseRevision = (rows = [], fallback = '') => {
  let latest = '';
  let latestTime = Number.NaN;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const candidate = clean(row?.revised, 80);
    const candidateTime = Date.parse(candidate);
    if (!candidate || !Number.isFinite(candidateTime)) return;
    if (!Number.isFinite(latestTime) || candidateTime > latestTime) {
      latest = candidate;
      latestTime = candidateTime;
    }
  });
  return latest || clean(fallback, 80);
};

const itemKey = (value) => clean(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const matchesAny = (value, patterns) => patterns.some((pattern) => pattern.test(value));

const packOutSection = (row) => {
  const sourceSection = clean(row?.sourceSection, 160);
  if (sourceSection) return sourceSection.toUpperCase();
  // Rows that have passed through withPackOutSourceSections belong to the
  // authored Caterease stream even when they precede its first heading (for
  // example an event-level NOTE row).  Do not replace that intentional blank
  // section with the row's database category.
  if (Object.prototype.hasOwnProperty.call(row || {}, 'sourceSection')) return '';
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
  if (matchesAny(name, [/square lucite/, /square black inserts?/])) return 'TRAYS';
  if (matchesAny(name, [/cake stand/, /champagne bucket/])) return 'CAKE STAND';
  if (matchesAny(name, [/c folds?/, /dish soap/, /dish sponge/, /tray cleaning spray/, /microfiber cloths?/, /first aid kit$/])) return 'SANITATION KIT';
  if (matchesAny(name, [/electric crepe maker/, /pam spray/, /microplane/])) return 'SPECIALTY KITCHEN EQUIPMENT';
  if (matchesAny(name, [/chef apron/, /cutting board/, /knife serrated/, /sheet pans?/, /mixing bowl/, /^spoons? /, /salt and pepper/, /olive oil/, /fish spatula/, /squeeze bottle/, /whisk/, /tongs?$/, /rubber spatula/, /plastic teaspoons?/, /plastic tasting spoons?/])) return 'KITCHEN EQUIPMENT';
  if (matchesAny(name, [/standard from united/])) return 'ICE';
  if (category.toLowerCase() === 'disposable') return 'DISPOSABLE ITEMS';
  if (menuGroup.toLowerCase() === 'kitchen equipment') return 'KITCHEN EQUIPMENT';
  if (category.toLowerCase() === 'beverage disregard') return 'BEVERAGE';
  if (category.toLowerCase() === 'beverage item name') return 'BEVERAGE';
  return category || menuGroup || 'UNASSIGNED';
};

const PACK_OUT_SECTION_ORDER = [
  'KITCHEN EQUIPMENT', 'SPECIALTY KITCHEN EQUIPMENT', 'SANITATION KIT', 'DISPOSABLE ITEMS',
  'TRAYS', 'ICE', 'WATER', 'SODA', 'JUICE', 'GARNISH', 'BEVERAGE', 'ADDITIONAL',
  'CLEANING', 'CAKE STAND', 'STAFF ITEMS', 'COFFEE EQUIPMENT', 'UNASSIGNED',
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
  const widths = includePhotos ? [2900, 700, 2800, 1000, 1000, 1700] : [2945, 1021, 3079, 1667, 2073];
  const headers = ['Name', 'Qty', 'Notes/Comments', 'Delivered', 'Returned', ...(includePhotos ? ['Photo'] : [])];
  const header = `<w:tr>${headers.map((value, index) => cell(value, {
    bold: true,
    width: widths[index],
    shading: 'E7E6E6',
    align: 'center',
  })).join('')}</w:tr>`;
  const sectionRow = (name) => `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${widths.length}"/><w:tcW w:w="${widths.reduce((total, width) => total + width, 0)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(name, { bold: true, size: 20, align: 'center', after: 0 })}</w:tc></w:tr>`;
  const body = [...groups.entries()].map(([group, values]) => {
    const displayGroup = clean(String(group).split('\u0000')[0], 160);
    return `${displayGroup ? sectionRow(displayGroup.toUpperCase()) : ''}${values.map((row) => `<w:tr>${[
    { value: row.itemName, align: 'center' },
    { value: Number(row.quantity) === 0 ? '' : formatQuantity(row.quantity), align: 'center' },
    { value: row.manual ? [row.notes, row.unit].filter(Boolean).join(' · ') : row.notes || '', align: '' },
    { value: '', align: '' },
    { value: '', align: '' },
  ].map(({ value, align }, index) => cell(value, { width: widths[index], align })).join('')}${includePhotos ? imageCell(imageByName.get(itemKey(row.itemName)), widths[5]) : ''}</w:tr>`).join('')}`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${tableBorders}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header}${body}</w:tbl>`;
};

const expandKitchenPackOutRecipeGroups = (groups, recipes = []) => {
  const recipeIndex = buildExactRecipeMatchIndex(recipes);
  return new Map([...groups.entries()].map(([group, values]) => {
    const requiredItems = values.filter((row) => !row?.topLevelFoodService);
    if (requiredItems.length) return [group, requiredItems];
    const topLevelRows = values.filter((row) => row?.topLevelFoodService);
    if (topLevelRows.some((row) => row?.useRecipe === false)) {
      return [group, topLevelRows.map((row) => ({
        ...row,
        topLevelFoodService: false,
      }))];
    }
    const match = resolveExactRecipeMatch(group, recipeIndex);
    const ingredients = match.status === 'matched' && Array.isArray(match.recipe?.ingredients)
      ? match.recipe.ingredients.filter((ingredient) => clean(ingredient?.name, 300))
      : [];
    if (!ingredients.length) return [group, values];
    return [group, ingredients.map((ingredient) => ({
      itemName: clean(ingredient.name, 300),
      quantity: numberOrNull(ingredient.quantity),
      unit: clean(ingredient.unit, 80),
      recipeFallback: true,
    }))];
  }));
};

const STAFF_MEAL_OPTION_PATTERN = /^option\s+[a-z0-9]+\s*:/i;

const kitchenPackOutStaffMeal = (snapshot, rows) => {
  const foodServiceRows = snapshot?.foodService || snapshot?.packOut || [];
  const requiredRow = (Array.isArray(rows) ? rows : []).find((row) => (
    STAFF_MEAL_OPTION_PATTERN.test(clean(row?.station || row?.itemName, 300))
  ));
  const foodServiceIndex = foodServiceRows.findIndex((row) => (
    STAFF_MEAL_OPTION_PATTERN.test(clean(row?.itemName || row?.station, 300))
  ));
  const foodServiceRow = foodServiceIndex >= 0 ? foodServiceRows[foodServiceIndex] : null;
  const name = clean(
    requiredRow?.station || requiredRow?.itemName || foodServiceRow?.itemName || foodServiceRow?.station,
    300
  );
  // Required-item quantities describe each ingredient, not the number of staff meals.
  const directQuantity = Number(foodServiceRow?.quantity);
  const staffMealParent = foodServiceIndex > 0
    ? foodServiceRows.slice(0, foodServiceIndex).reverse().find((row) => (
      clean(row?.subEvent, 120) === clean(foodServiceRow?.subEvent, 120)
      && /^staff\s*meals?$/i.test(clean(row?.itemName, 300))
      && Number(row?.quantity) > 0
    ))
    : null;
  const quantityValue = directQuantity > 0 ? directQuantity : Number(staffMealParent?.quantity);
  return {
    name,
    quantity: Number.isFinite(quantityValue) && quantityValue > 0 ? formatQuantity(quantityValue) : '',
    notes: withoutRepeatedItemPrefix(foodServiceRow?.notes || requiredRow?.notes, name),
  };
};

const catereaseKitchenPackOutTable = (groups, recipes = [], staffMeal = {}) => {
  const expandedGroups = expandKitchenPackOutRecipeGroups(groups, recipes);
  const widths = [5300, 1400, 1600, 1600, 1500];
  const headers = ['', 'Quantity', 'Not Enough', 'Just Enough', 'Too Much'];
  const header = `<w:tr>${headers.map((value, index) => cell(value, {
    bold: true,
    width: widths[index],
    shading: 'E7E6E6',
    align: 'center',
  })).join('')}</w:tr>`;
  const sectionRow = (name) => `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${widths.length}"/><w:tcW w:w="${widths.reduce((total, width) => total + width, 0)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(name, { bold: true, size: 20, after: 0 })}</w:tc></w:tr>`;
  const detailRow = (name) => `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${widths.length}"/><w:tcW w:w="${widths.reduce((total, width) => total + width, 0)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(name, { size: 20, after: 0 })}</w:tc></w:tr>`;
  const orderedGroups = [...expandedGroups.entries()].sort(([left], [right]) => (
    Number(STAFF_MEAL_OPTION_PATTERN.test(clean(left, 300)))
      - Number(STAFF_MEAL_OPTION_PATTERN.test(clean(right, 300)))
  ));
  const body = orderedGroups.map(([group, values]) => {
    const isStaffMeal = STAFF_MEAL_OPTION_PATTERN.test(clean(group, 300));
    const groupHeading = isStaffMeal ? 'Staff Meal' : group;
    const staffMealDetail = isStaffMeal
      ? [staffMeal.name || clean(group, 300), staffMeal.notes].filter(Boolean).join(' - ')
      : '';
    const rowsXml = values.filter((row) => !row.topLevelFoodService).map((row) => `<w:tr>${[
      row.manual && row.notes ? `${row.itemName} — ${row.notes}` : row.itemName,
      row.manual ? [formatQuantity(row.quantity), row.unit].filter(Boolean).join(' ') : '', '', '', '',
    ].map((value, index) => cell(value, { width: widths[index], align: index ? 'center' : '' })).join('')}</w:tr>`).join('');
    return `${sectionRow(groupHeading)}${staffMealDetail ? detailRow(staffMealDetail) : ''}${rowsXml}`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${tableBorders}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${header}${body}</w:tbl>`;
};

const packOutTable = (rows, decorImages = [], includeTemplate = true) => {
  const filteredRows = rows.filter((row) => clean(row?.menuGroup, 160).toLowerCase() !== 'standard');
  const hasSourceSections = !includeTemplate && filteredRows.some((row) => (
    Object.prototype.hasOwnProperty.call(row || {}, 'sourceSection')
  ));
  const orderedGroups = hasSourceSections
    ? filteredRows.reduce((entries, row) => {
      const section = packOutSection(row);
      const previous = entries.at(-1);
      if (!previous || previous[0].split('\u0000')[0] !== section) {
        entries.push([`${section}\u0000${entries.length}`, [row]]);
      } else {
        previous[1].push(row);
      }
      return entries;
    }, [])
    : [...templatedPackOutGroups(filteredRows, includeTemplate).entries()].sort(([left], [right]) => {
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

const operationalTimeParts = (value) => {
  const text = clean(value, 80);
  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return { hour, minute };
  }
  const twelveHour = text.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!twelveHour) return null;
  const displayHour = Number(twelveHour[1]);
  const minute = Number(twelveHour[2]);
  if (displayHour < 1 || displayHour > 12 || minute < 0 || minute >= 60) return null;
  return { hour: (displayHour % 12) + (twelveHour[3].toLowerCase() === 'p' ? 12 : 0), minute };
};

const formatOperationalTime = (value) => {
  const parts = operationalTimeParts(value);
  if (!parts) return clean(value, 80);
  return `${parts.hour % 12 || 12}:${String(parts.minute).padStart(2, '0')} ${parts.hour >= 12 ? 'pm' : 'am'}`;
};

const operationalShiftHours = (startTime, endTime) => {
  const start = operationalTimeParts(startTime);
  const end = operationalTimeParts(endTime);
  if (!start || !end) return '';
  const startMinutes = start.hour * 60 + start.minute;
  let endMinutes = end.hour * 60 + end.minute;
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return formatQuantity((endMinutes - startMinutes) / 60);
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

export const catereaseOperationalZoneKey = operationalZoneIdentity;

const manualAdditionMatches = (addition, type, zoneKey, templateKey) => (
  clean(addition?.documentType, 40).toLowerCase() === clean(type, 40).toLowerCase()
  && (!clean(addition?.templateKey, 200) || clean(addition.templateKey, 200).toLowerCase() === clean(templateKey, 200).toLowerCase())
  && (!clean(addition?.zoneKey, 200) || clean(addition.zoneKey, 200).toLowerCase() === clean(zoneKey, 200).toLowerCase())
);

const manualAdditionRow = (addition, type = '') => ({
  sourceId: `manual:${clean(addition?._id, 100)}`,
  manualAdditionId: clean(addition?._id, 100),
  manual: true,
  itemName: clean(addition?.itemName, 300),
  quantity: addition?.quantity,
  unit: clean(addition?.unit, 80),
  notes: clean(addition?.notes, 1000),
  station: clean(addition?.station, 200),
  category: clean(addition?.category, 200),
  menuGroup: 'Manual additions',
  position: type === 'staff_request' ? clean(addition?.itemName, 300) : '',
  required: type === 'staff_request' ? addition?.quantity : undefined,
  comments: type === 'staff_request' ? clean(addition?.notes, 1000) : '',
});

export const operationalRows = (snapshot, type, zoneKey = '', templateKey = '', manualAdditions = []) => {
  const version = Number(snapshot?.schemaVersion) || 1;
  const normalizedZoneKey = clean(zoneKey, 200).toLowerCase();
  const routedKitchenPackOut = type === 'kitchen_packout' && normalizedZoneKey.startsWith('kpo-route:')
    ? (Array.isArray(snapshot?.kitchenPackOutDocuments) ? snapshot.kitchenPackOutDocuments : [])
      .find((document) => clean(document?.zoneKey, 200).toLowerCase() === normalizedZoneKey)
    : null;
  let rows;
  const templates = Array.isArray(snapshot?.packOutTemplates) ? snapshot.packOutTemplates : undefined;
  const template = catereasePackOutTemplate(templateKey, templates);
  if (template && template.documentType === type) {
    rows = catereaseOperationalTemplateRows(snapshot, template.key, templates);
  }
  if (!template && type === 'po') rows = (version >= 2 ? snapshot?.packOut : snapshot?.kitchenMenu) || [];
  if (!template && type === 'kitchen_packout') {
    rows = (version >= 3 ? snapshot?.kitchenPackOut : version >= 2 ? snapshot?.kitchenMenu : snapshot?.packOut) || [];
  }
  if (type === 'staff_request') rows = snapshot?.staffRequest || [];
  if (['kitchen_menu', 'annotated_kitchen_menu'].includes(type) && version >= 3) {
    const derivedKitchenMenu = buildKitchenMenuRows(snapshot?.kitchenPackOut || []);
    rows = derivedKitchenMenu.length
      ? mergeKitchenMenuRows(derivedKitchenMenu, snapshot?.kitchenMenu || [])
      : snapshot?.kitchenMenu || [];

    // Older saved Kitchen Menu rows did not retain FSType. Recover it from
    // the matching food-service row so cocktails are classified correctly
    // even before an event is refreshed again.
    const foodServiceById = new Map((snapshot?.foodService || snapshot?.packOut || [])
      .map((row) => [clean(row?.foodServiceId || row?.sourceId, 120).toLowerCase(), row])
      .filter(([key]) => key));
    rows = (Array.isArray(rows) ? rows : []).map((row) => {
      const source = foodServiceById.get(clean(row?.foodServiceId || row?.sourceId, 120).toLowerCase());
      if (!source) return row;
      return {
        ...row,
        fsType: row?.fsType || source?.fsType || '',
        category: row?.category || source?.category || '',
      };
    });
  }
  if (['kitchen_menu', 'annotated_kitchen_menu'].includes(type) && version < 3) {
    const legacyKitchenPackOut = (version >= 2 ? snapshot?.kitchenMenu : snapshot?.packOut) || [];
    rows = buildKitchenMenuRows(legacyKitchenPackOut);
  }
  const kitchenPackOutSection = type === 'kitchen_packout' && normalizedZoneKey.startsWith('kpo-section:')
    ? catereaseKitchenPackOutDocumentGroups(snapshot, rows)
      .find((group) => group.zoneKey === normalizedZoneKey)
    : null;
  const sourceRows = routedKitchenPackOut
    ? routedKitchenPackOut.rows
    : kitchenPackOutSection
    ? kitchenPackOutSection.rows
    : normalizedZoneKey
      ? (Array.isArray(rows) ? rows : []).filter((row) => catereaseOperationalZoneKey(row) === normalizedZoneKey)
      : (Array.isArray(rows) ? rows : []);
  const additions = (Array.isArray(manualAdditions) ? manualAdditions : [])
    .filter((addition) => manualAdditionMatches(addition, type, zoneKey, templateKey))
    .map((addition) => manualAdditionRow(addition, type))
    .filter((row) => row.itemName);
  return [...sourceRows, ...additions];
};

const withoutRepeatedItemPrefix = (value, itemName) => {
  const text = clean(catereaseRichTextToPlain(value), 12000);
  const ignored = new Set(['a', 'an', 'and', 'of', 'the', 'with']);
  const tokens = (source) => [...String(source || '').matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => ({
      value: match[0].normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
      end: Number(match.index) + match[0].length,
    }))
    .filter((token) => !ignored.has(token.value));
  const nameTokens = tokens(itemName).map((token) => token.value);
  const detailTokens = tokens(text);
  if (!text || !nameTokens.length || detailTokens.length < nameTokens.length) return text;
  if (!nameTokens.every((token, index) => detailTokens[index]?.value === token)) return text;
  return text.slice(detailTokens[nameTokens.length - 1].end).replace(/^[\s:;,\-.()]+/, '').trim();
};

const kitchenMenuSections = (rows, recipes, includeAnnotations = false) => {
  const recipeIndex = buildExactRecipeMatchIndex(recipes);
  const preparedRows = rows.map((row) => {
    const match = resolveExactRecipeMatch(row?.itemName, recipeIndex);
    const recipe = match.status === 'matched' ? match.recipe : null;
    const dishKey = itemKey(row?.itemName);
    const description = withoutRepeatedItemPrefix(row?.description, row?.itemName);
    const comments = [row?.notes]
      .map((value) => withoutRepeatedItemPrefix(value, row?.itemName))
      .filter((value, index, values) => value && itemKey(value) !== dishKey && values.indexOf(value) === index);
    const labels = [recipe?.instructions, recipe?.notes]
      .map((value) => clean(catereaseRichTextToPlain(value), 12000))
      .filter((value, index, values) => value && itemKey(value) !== dishKey && values.indexOf(value) === index);
    return {
      ...row,
      group: clean(row?.menuGroup || row?.category || row?.prepArea, 160) || 'Menu',
      itemName: clean(row?.itemName, 300) || 'Untitled dish',
      itemDetails: description
        ? [clean(row?.itemName, 300) || 'Untitled dish', description]
        : clean(row?.itemName, 300) || 'Untitled dish',
      comments,
      labels: includeAnnotations ? labels : [],
    };
  });
  const isBeverage = (row) => /\b(?:bar|beverages?|cocktails?|mocktails?|wine|beer|liquor|alcohol|spirits?|champagne|sparkling)\b/i.test([
    row?.menuGroup, row?.category, row?.prepArea, row?.fsType,
  ].filter(Boolean).join(' '));
  const kitchenMenuQuantity = (value) => Number(value) > 0 ? formatQuantity(value) : '';
  const renderSection = (heading, values) => {
    const bodyRows = [];
    [...groupedRows(values, (row) => row.group).entries()].forEach(([group, grouped]) => {
      if (!['menu', 'unassigned', heading.toLowerCase()].includes(group.toLowerCase())) {
        bodyRows.push(['', group.toUpperCase(), '', '']);
      }
      grouped.forEach((row) => bodyRows.push([
        kitchenMenuQuantity(row.quantity),
        row.itemDetails,
        row.comments,
        row.labels,
      ]));
    });
    return `${paragraph(heading, { bold: true, size: 28, before: 220, after: 80 })}${
      table(['Qty', 'Item', 'Comment', 'Label (OCC; Rentals)'], bodyRows, [570, 4580, 2825, 3105])
    }`;
  };
  const menuRows = [];
  const beverageRows = [];
  preparedRows.forEach((row) => {
    const previousBeverage = beverageRows[beverageRows.length - 1];
    const cocktailGarnish = /^garnish\s*:/i.test(row.itemName)
      && previousBeverage
      && isBeverage(previousBeverage);
    if (cocktailGarnish) {
      const garnishComments = row.comments.length ? row.comments : [row.itemName];
      previousBeverage.comments = [...previousBeverage.comments, ...garnishComments]
        .filter((value, index, values) => value && values.indexOf(value) === index);
      return;
    }
    if (isBeverage(row)) {
      const beverageGroup = isBeverage({ menuGroup: row.group }) ? row.group : 'Beverage';
      beverageRows.push({ ...row, group: beverageGroup });
    }
    else menuRows.push(row);
  });
  return `${renderSection('MENU', menuRows)}${beverageRows.length ? renderSection('BEVERAGE', beverageRows) : ''}`;
};

const kitchenEventNotesSection = (event) => {
  const notes = clean(
    event?.meta?.eventNotes
      || event?.meta?.operationsNotes
      || event?.meta?.nowsta?.adminNotes,
    12000
  );
  if (!notes) return '';
  return `${paragraph('EVENT NOTES', { bold: true, size: 28, before: 220, after: 80 })}${
    table([], [[notes]], [10600])
  }`;
};

const kitchenStaffingSection = (event, snapshot) => {
  const catereaseShifts = Array.isArray(snapshot?.staffRequest) ? snapshot.staffRequest : [];
  const shifts = catereaseShifts.length
    ? catereaseShifts.map((shift) => ({
      position: shift.position,
      startTime: shift.startTime,
      uniform: shift.uniform,
      comments: shift.comments,
      quantity: shift.required,
    }))
    : (Array.isArray(event?.meta?.nowsta?.shifts) ? event.meta.nowsta.shifts : []);
  if (!shifts.length) return '';
  const uniform = clean(event?.meta?.nowsta?.uniform, 300);
  const rows = shifts.map((shift) => {
    const assigned = Array.isArray(shift?.workers) ? shift.workers.length : 0;
    const unfilled = Math.max(0, Number(shift?.unfilled) || 0);
    const requested = Number(shift?.quantity);
    return [
      formatQuantity(Number.isFinite(requested) ? requested : assigned + unfilled),
      clean(shift?.position, 200),
      formatOperationalTime(shift?.startTime),
      clean(shift?.uniform, 300) || uniform,
      clean(shift?.comments, 1000),
    ];
  }).filter((row) => row[1]);
  if (!rows.length) return '';
  return `${paragraph('STAFFING INFO', { bold: true, size: 28, before: 220, after: 80 })}${
    table(['#', 'Position', 'Start', 'Uniform', 'Comments'], rows, [1000, 2150, 1100, 3950, 2400])
  }`;
};

const documentXml = ({ event, snapshot, type, recipes = [], includeBrandLogo = false, decorImages = [], includePackOutTemplate = true, zoneKey = '', zoneName = '', templateKey = '', manualAdditions = [] }) => {
  const isKitchenPackOut = type === 'kitchen_packout';
  const isStaffRequest = type === 'staff_request';
  const isKitchenMenu = ['kitchen_menu', 'annotated_kitchen_menu'].includes(type);
  const isAnnotatedKitchenMenu = type === 'annotated_kitchen_menu';
  const template = catereasePackOutTemplate(templateKey, snapshot?.packOutTemplates);
  const rows = operationalRows(snapshot, type, zoneKey, templateKey, manualAdditions);
  const title = template?.label?.toUpperCase() || (isAnnotatedKitchenMenu ? 'ANNOTATED KITCHEN MENU' : isKitchenMenu ? 'KITCHEN MENU' : isKitchenPackOut ? 'KITCHEN PACK OUT' : isStaffRequest ? 'STAFF REQUEST FORM' : 'PACK OUT');
  const groups = groupedRows(rows, (row) => (
    row?.manual ? 'Manual additions'
      : template?.groupBy?.length
      ? template.groupBy.map((field) => row?.[field]).filter(Boolean).join(' / ')
        || row.station || row.prepArea || row.category
      : template
        ? 'Required Items'
        : isKitchenPackOut
          ? row.station || row.prepArea
      : row.menuGroup || row.category || row.prepArea
  ));
  const foodServiceSourceIds = new Set((snapshot?.foodService || snapshot?.packOut || [])
    .map((row) => clean(row?.sourceId, 120))
    .filter(Boolean));
  const usesFoodServicePackOut = type === 'po' && rows.some((row) => (
    Object.prototype.hasOwnProperty.call(row || {}, 'sourceSection')
    || foodServiceSourceIds.has(clean(row?.sourceId, 120))
  ));
  const staffMeal = isKitchenPackOut ? kitchenPackOutStaffMeal(snapshot, rows) : {};
  const staffTotal = rows.reduce((total, row) => total + (Number(row?.required) || 0), 0);
  const sections = isKitchenMenu ? kitchenMenuSections(rows, recipes, isAnnotatedKitchenMenu) : isStaffRequest
    ? table(['#', 'Position', 'Start', 'End', 'Hours', 'Uniform', 'Admin Notes', 'Comments'], [
      ...rows.map((row) => [
        formatQuantity(row.required),
        row.position,
        formatOperationalTime(row.startTime),
        formatOperationalTime(row.endTime),
        operationalShiftHours(row.startTime, row.endTime),
        row.uniform,
        '',
        row.comments,
      ]),
      [formatQuantity(staffTotal), 'TOTAL STAFF NEEDED', '', '', '', '', '', ''],
    ], [550, 1900, 1000, 1000, 700, 2100, 1500, 1850])
    : isKitchenPackOut ? catereaseKitchenPackOutTable(groups, recipes, staffMeal)
    : usesFoodServicePackOut ? packOutTable(rows, decorImages, false)
    : template ? catereasePackOutTable(new Map([...groups.entries()].map(([group, values]) => [
      group,
      values.map((row) => ({
        itemName: row.itemName,
        quantity: row.quantity,
        notes: [row.notes, row.unit, row.vendor].filter((value, index, values) => value && values.indexOf(value) === index).join(' · '),
      })),
    ]))) : packOutTable(rows, decorImages, includePackOutTemplate);
  const parsedEventGuestCount = Number(event?.meta?.guestCount);
  const legacyGuestRow = rows.find((row) => itemKey(row?.itemName) === 'food' && clean(row?.menuGroup).toLowerCase() === 'standard');
  const parsedSnapshotGuestCount = Number(snapshot?.guestCount ?? legacyGuestRow?.quantity);
  const guestCount = Number.isFinite(parsedEventGuestCount) && parsedEventGuestCount > 0
    ? parsedEventGuestCount
    : Number.isFinite(parsedSnapshotGuestCount) && parsedSnapshotGuestCount > 0 ? parsedSnapshotGuestCount : '';
  const snapshotEventTiming = [
    formatOperationalTime(snapshot?.eventStartTime),
    formatOperationalTime(snapshot?.eventEndTime),
  ].filter(Boolean).join(' – ');
  const eventTiming = event?.meta?.eventTime || snapshotEventTiming;
  const packOutEventTiming = [
    formatOperationalTime(snapshot?.serviceStartTime),
    formatOperationalTime(snapshot?.serviceEndTime),
  ].filter(Boolean).join(' - ') || eventTiming;
  const salesRep = event?.meta?.salesRep || snapshot?.salesRep || '';
  const deliveryTime = event?.meta?.deliveryTime
    || formatOperationalTime(snapshot?.deliveryTime)
    || '';
  const staffingRows = Array.isArray(snapshot?.staffRequest) && snapshot.staffRequest.length
    ? snapshot.staffRequest
    : Array.isArray(event?.meta?.nowsta?.shifts) ? event.meta.nowsta.shifts : [];
  const staffArrivalTime = formatOperationalTime(
    event?.meta?.staffArrivalTime || staffingRows.find((shift) => shift?.startTime)?.startTime || ''
  );
  const printableZoneName = clean(zoneName, 200);
  const genericZoneNames = new Set(['main', 'menu', 'pack out', 'staffing']);
  const isGenericZoneName = genericZoneNames.has(printableZoneName.toLowerCase());
  const packOutName = !isGenericZoneName
    ? clean(printableZoneName
      .replace(/^pack\s*out\s*(?:[-–—:]\s*)?/i, '')
      .replace(/\s+pack\s*out$/i, ''), 200)
    : '';
  const packOutEventName = packOutName
    ? `${event?.title || 'Event'}_${packOutName.toUpperCase()}`
    : event?.title;
  const normalizedZoneKey = clean(zoneKey, 200).toLowerCase();
  const revisionRows = type === 'po' && normalizedZoneKey
    ? (snapshot?.foodService || snapshot?.packOut || []).filter((row) => (
      operationalZoneIdentity(row) === normalizedZoneKey
    ))
    : rows;
  const documentRevised = latestCatereaseRevision(revisionRows, snapshot?.eventRevised);
  const zoneHeading = printableZoneName && !genericZoneNames.has(printableZoneName.toLowerCase())
    ? paragraph(printableZoneName, { bold: true, size: 36, color: 'FF0000', align: 'center', after: 120 })
    : '';
  const eventDetailsTable = table([], [
    [eventNameCell('Event: ', packOutEventName), highlightedValueCell('Event Date: ', longDate(event?.date))],
    [labeledValueCell('Sales Rep: ', salesRep), labeledValueCell('Event Timing: ', packOutEventTiming, { valueBold: true })],
    [labeledValueCell('Guests: ', guestCount), labeledValueCell('Delivery Time: ', deliveryTime)],
    [labeledValueCell('Event Number: ', displayedEventNumber(event?.externalId || snapshot?.eventId || '')), labeledValueCell('Date PO Modified: ', catereaseModifiedDateTime(documentRevised))],
  ], [5327, 5328]);
  const staffMealHeader = [staffMeal.quantity, staffMeal.name].filter(Boolean).join(' - ');
  const kitchenPackOutTitle = template?.label || 'Kitchen Pack Out';
  const kitchenPackOutDetailsTable = table([], [[
    [
      eventNameCell('Event Name: ', event?.title),
      `Date: ${longDate(event?.date)}`,
      `Guest Count: ${guestCount}`,
      `Client: ${event?.client || snapshot?.client || ''}`,
      `Location: ${event?.meta?.venue || event?.meta?.nowsta?.venue || snapshot?.eventVenue || ''}`,
      `Address: ${event?.meta?.address || event?.meta?.nowsta?.address || snapshot?.eventAddress || ''}`,
    ],
    [
      { runs: [{ value: kitchenPackOutTitle, bold: true, size: 32 }] },
      `Event Date: ${shortDate(event?.date)}`,
      `Delivery: ${deliveryTime}`,
      `Tape: ${event?.meta?.tape || ''}`,
      `Staff Meal: ${staffMealHeader}`,
    ],
  ]], [5300, 5300]);
  const documentHeader = isKitchenMenu ? `${paragraph(title, { bold: true, size: 36, align: 'center', after: 120 })}${zoneHeading}${table([], [
    [eventNameCell('Event Name: ', event?.title), `Event Timing: ${eventTiming}`],
    [`Date: ${longDate(event?.date)}`, `Staff Arrival on Site: ${staffArrivalTime}`],
    [`Guest Count: ${guestCount}`, `Sales Rep: ${salesRep}`],
    [`Client: ${event?.client || snapshot?.client || ''}`, `Site Contact: ${event?.meta?.siteContact || ''}`],
    [`Location: ${event?.meta?.venue || event?.meta?.nowsta?.venue || ''}`, `Last Modified: ${catereaseModifiedDateTime(snapshot?.eventRevised || event?.updatedAt)}`],
    [`Address: ${event?.meta?.address || event?.meta?.nowsta?.address || ''}`, `Service Entrance: ${event?.meta?.serviceEntrance || ''}`],
    [`Client Notes: ${event?.meta?.clientNotes || ''}`, `Meeting Point: ${event?.meta?.meetingPoint || ''}`],
    [`Venue Notes: ${event?.meta?.venueNotes || ''}`, `Event Number: ${displayedEventNumber(event?.externalId || snapshot?.eventId || '')}`],
    [`Allergen/Restrictions: ${event?.meta?.allergens || event?.meta?.restrictions || ''}`, ''],
  ], [5300, 5300])}` : isKitchenPackOut
    ? `${zoneHeading}${kitchenPackOutDetailsTable}`
    : isStaffRequest
    ? `${paragraph(title, { bold: true, size: 36, align: 'center', after: 120 })}${zoneHeading}${eventDetailsTable}`
    : `${paragraph('Revision', { bold: true, size: 32, align: 'right', after: 80 })}${eventDetailsTable}`;
  const templateTopNotes = clean(catereaseRichTextToPlain(template?.topNotes), 12000);
  const templateBottomNotes = clean(catereaseRichTextToPlain(template?.bottomNotes), 12000);
  const documentFooterSections = isKitchenMenu
    ? `${kitchenStaffingSection(event, snapshot)}${kitchenEventNotesSection(event)}`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  ${includeBrandLogo ? brandLogoParagraph() : ''}
  ${documentHeader}
  ${templateTopNotes ? paragraph(templateTopNotes, { size: 20, before: 100, after: 100 }) : ''}
  ${sections || paragraph('No rows returned by Caterease.', { size: 20, before: 240 })}
  ${templateBottomNotes ? paragraph(templateBottomNotes, { size: 20, before: 100, after: 100 }) : ''}
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
  templateKey = '',
  manualAdditions = [],
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
    templateKey,
    manualAdditions,
  }));
  word.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Avenir Medium" w:hAnsi="Avenir Medium"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`);
  if (includeBrandLogo) word.folder('media').file('logo.svg', brandLogoSvg);
  embeddedDecorImages.forEach((image) => word.folder('media').file(image.fileName, image.buffer));
  word.folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${includeBrandLogo ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.svg"/>' : ''}${embeddedDecorImages.map((image) => `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`).join('')}</Relationships>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
