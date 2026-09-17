import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  buildCatereaseOperationalSnapshot,
  buildKitchenMenuRows,
  catereaseOperationalGuestCount,
  normalizeCatereaseKitchenMenuDishRows,
  normalizeCatereaseKitchenPackOutRows,
  normalizeCatereasePackOutRows,
  normalizeCatereaseStaffRequestRows,
  operationalRows,
  packOutRenderedItemNames,
  renderCatereaseOperationalDocx,
} from '../utils/catereaseOperations.js';
import { renderCatereaseStaffRequestXlsx } from '../utils/catereaseStaffRequestXlsx.js';
import {
  CATEREASE_OPERATIONAL_BAR_ITEMS_VERSION,
  catereaseOperationalPackOutToBarItems,
  hasAppliedCatereaseOperationalChecksum,
  shouldUpdateCatereaseOperationalGuestCount,
} from '../utils/catereaseOperationalBarItems.js';
import { runImportedBarItemMergePipeline } from '../utils/barManualItems.js';
import {
  buildCatereasePackOutTemplateSummaries,
  catereaseKitchenPackOutDocumentGroups,
  catereaseOperationalTemplateRows,
  catereasePackOutTemplateRows,
  normalizeCatereasePrintTemplates,
} from '../utils/catereasePackOutTemplates.js';

const docxText = (xml) => [...String(xml || '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1])
  .join('')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'");

test('Kitchen Pack Out groups retain every ingredient when dish names have no keyword match', () => {
  const salmonStation = 'Ora king salmon crudo, passion fruit, gooseberries, pickled cucumber, jalapeño, lime, squid ink cracker GF, DF, NF';
  const eggplantStation = 'Norwich Farm Roasted Eggplant, burnt eggplant puree, pomegranate, crispy black wild rice (GF, DF, Vegan, NF)';
  const salmonIngredients = [
    'Alyssum flowers', 'Cucumber rolls', 'FDS', 'Fennel Fronds', 'Gooseberries',
    'Medium sized Nasturtium Leaves', 'Ora king salmon', 'Passionfruit vinaigrette',
    'Pickled cucumber', 'Pickled jalapeno', 'Purple daikon or watermelon radish',
    'Squid ink cracker', 'Yellow Viola flowers',
  ];
  const eggplantIngredients = [
    'Nasturtium leaves', 'Chinese broccoli', 'Puffed black rice', 'Pickled apricot',
    'Pomegranate seeds', 'Charred eggplant puree', 'Miso roasted eggplant',
  ];
  const rows = [
    ...salmonIngredients.map((itemName, index) => ({
      sourceId: `salmon-${index}`,
      foodServiceId: 'FS-SALMON',
      itemName,
      station: salmonStation,
      category: 'Pack Out',
    })),
    ...eggplantIngredients.map((itemName, index) => ({
      sourceId: `eggplant-${index}`,
      foodServiceId: 'FS-EGGPLANT',
      itemName,
      station: eggplantStation,
      category: 'Pack Out',
    })),
  ];
  const groups = catereaseKitchenPackOutDocumentGroups({
    foodService: [
      { sourceId: 'heading', itemName: "PASSED HORS D'OEUVRES", subEvent: 'S-MENU' },
      { sourceId: 'dish-salmon', foodServiceId: 'FS-SALMON', itemName: salmonStation, subEvent: 'S-MENU' },
    ],
  }, rows);
  const groupedRows = groups.flatMap((group) => group.rows);
  assert.equal(groupedRows.length, rows.length);
  assert.equal(new Set(groupedRows.map((row) => row.sourceId)).size, rows.length);
  assert.deepEqual(
    groups.find((group) => group.key === 'passed-hds')?.rows.map((row) => row.itemName),
    salmonIngredients,
  );
  assert.deepEqual(
    groups.find((group) => group.key === 'additional-items')?.rows.map((row) => row.itemName),
    eggplantIngredients,
  );
});

test('Caterease exposes only the two real operational Pack Out document types', () => {
  const rows = normalizeCatereaseKitchenPackOutRows([
    { UID: '1', ItemName: 'Chafing Dish', Qty: 2, FSType: 'Equipment', Category: 'Hot', FSName: 'Buffet', FSPrepArea: 'Hot Line' },
    { UID: '2', ItemName: 'Bread', Qty: 12, FSType: 'Food', Category: 'Bakery', FSName: 'Bread Service', FSPrepArea: 'Pantry' },
  ]);
  const summaries = buildCatereasePackOutTemplateSummaries(rows);
  assert.deepEqual(summaries.map(({ key, rowCount }) => [key, rowCount]), [
    ['kitchen_pack_out', 1],
    ['pack_out', 1],
  ]);
  assert.deepEqual(catereasePackOutTemplateRows(rows, 'pack_out').map((row) => row.itemName), ['Chafing Dish']);
  assert.equal(rows[0].fsType, 'Equipment');
  assert.equal(rows[0].category, 'Hot');
});

test('manual operational additions appear only in their matching document template and zone', () => {
  const snapshot = {
    schemaVersion: 9,
    packOutTemplates: [
      { key: 'pack-template', documentType: 'po' },
      { key: 'kpo-template', documentType: 'kitchen_packout' },
    ],
    requiredItems: [],
    foodService: [],
  };
  const additions = [{
    _id: 'manual-one',
    documentType: 'po',
    templateKey: 'pack-template',
    zoneKey: 's-dinner|dinner',
    itemName: 'Fruit Skewers',
    quantity: 12,
    unit: 'pcs',
    notes: 'Add by hand',
  }];
  assert.deepEqual(
    operationalRows(snapshot, 'po', 's-dinner|dinner', 'pack-template', additions)
      .map(({ itemName, quantity, unit, manual }) => ({ itemName, quantity, unit, manual })),
    [{ itemName: 'Fruit Skewers', quantity: 12, unit: 'pcs', manual: true }]
  );
  assert.equal(operationalRows(snapshot, 'po', 's-cocktail|cocktail', 'pack-template', additions).length, 0);
  assert.equal(operationalRows(snapshot, 'kitchen_packout', 's-dinner|dinner', 'kpo-template', additions).length, 0);
});

test('Pack Out rows preserve sequential Caterease sections and discard the heading records', () => {
  const snapshot = {
    schemaVersion: 18,
    requiredItems: [],
    foodService: [
      { sourceId: 'heading-1', itemName: 'BEVERAGE', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out - Beverage' },
      { sourceId: 'wine-heading', itemName: 'HOUSE COCKTAIL WINE', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out - Beverage' },
      { sourceId: 'wine', itemName: 'Sancerre', quantity: 12, subEvent: 'S-PO', zoneName: 'Pack Out - Beverage' },
      { sourceId: 'liquor-heading', itemName: 'VODKA', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out - Beverage' },
      { sourceId: 'liquor', itemName: 'Belvedere', quantity: 5, subEvent: 'S-PO', zoneName: 'Pack Out - Beverage' },
    ],
    packOutTemplates: [{ key: 'pack-template', documentType: 'po', conditions: [] }],
  };
  assert.deepEqual(
    operationalRows(snapshot, 'po', 's-po|pack out - beverage', 'pack-template')
      .map(({ itemName, sourceSection }) => [itemName, sourceSection]),
    [
      ['Sancerre', 'HOUSE COCKTAIL WINE'],
      ['Belvedere', 'VODKA'],
    ]
  );
});

test('Pack Out DOCX renders authored food-service sections instead of database categories', async () => {
  const snapshot = {
    schemaVersion: 19,
    guestCount: 75,
    foodService: [
      { sourceId: 'note', itemName: 'NOTE: Client providing CHAMPAGNE', quantity: 0, category: 'Beverage Disregard', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'water-heading', itemName: 'WATER', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'water', itemName: 'Panna', quantity: 16, category: 'Beverage Item Name', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'disposable-heading-1', itemName: 'DISPOSABLE ITEMS', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'napkins', itemName: 'Cocktail napkins', quantity: 200, category: 'Disposable', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'staff-heading', itemName: 'STAFF ITEMS', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'staff-water', itemName: 'Staff water', quantity: 15, category: 'Staff', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'kitchen-heading', itemName: 'KITCHEN EQUIPMENT', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'apron', itemName: 'Chef apron', quantity: 5, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'sanitation-heading', itemName: 'SANITATION KIT', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'soap', itemName: 'Dish soap', quantity: 1, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'disposable-heading-2', itemName: 'DISPOSABLE ITEMS', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'foil', itemName: 'Foil', quantity: 1, category: 'Disposable', subEvent: 'S-PO', zoneName: 'Pack Out' },
    ],
    packOutTemplates: [{ key: 'print-36', label: 'Pack Out', documentType: 'po', operationalVisible: true, groupBy: ['station'], conditions: [] }],
  };
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: "Bloomingdale's VIP Cocktail", date: '2026-09-16', externalId: 'E22842', meta: {} },
    snapshot,
    type: 'po',
    templateKey: 'print-36',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');

  assert.doesNotMatch(xml, />BEVERAGE ITEM NAME</);
  assert.doesNotMatch(xml, />BEVERAGE DISREGARD</);
  assert.equal((xml.match(/>DISPOSABLE ITEMS</g) || []).length, 2);
  const orderedText = ['NOTE: Client providing CHAMPAGNE', 'WATER', 'Panna', 'DISPOSABLE ITEMS', 'Cocktail napkins', 'STAFF ITEMS', 'Staff water', 'KITCHEN EQUIPMENT', 'Chef apron', 'SANITATION KIT', 'Dish soap'];
  let priorIndex = -1;
  orderedText.forEach((value) => {
    const index = xml.indexOf(`>${value}<`);
    assert.ok(index > priorIndex, `${value} should retain its Caterease section order`);
    priorIndex = index;
  });
});

test('Pack Out uses menu cocktail garnish structure when Caterease returns cocktail rows before their heading', () => {
  const snapshot = {
    schemaVersion: 19,
    foodService: [
      { sourceId: 'garnish-heading', itemName: 'GARNISH', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'lime', itemName: 'Lime Wheels', quantity: 50, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'basil', itemName: 'Garnish: Basil sprig', quantity: 50, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'tray-heading', itemName: 'TRAY', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'tray', itemName: 'Round Taco Insert', quantity: 2, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'flower', itemName: 'Garnish: Edible Flower', quantity: 50, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'arm', itemName: 'ARM IN ARM', quantity: 50, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'cocktail-heading', itemName: 'SPCEIALTY COCKTAIL', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'gin', itemName: 'GIN BASIL SMASH', quantity: 50, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'menu-arm', itemName: 'ARM IN ARM', quantity: 0, notes: 'Vodka GLASS: Nick and Nora GARNISH: Edible Flower', subEvent: 'S-MENU', zoneName: 'Menu' },
      { sourceId: 'menu-gin', itemName: 'GIN BASIL SMASH', quantity: 0, notes: 'Gin GLASS: Rocks GARNISH: Basil Sprig', subEvent: 'S-MENU', zoneName: 'Menu' },
    ],
    packOutTemplates: [{ key: 'print-36', label: 'Pack Out', documentType: 'po', operationalVisible: true, conditions: [] }],
  };

  assert.deepEqual(
    operationalRows(snapshot, 'po', '', 'print-36').map(({ itemName, sourceSection }) => [itemName, sourceSection]),
    [
      ['Lime Wheels', 'GARNISH'],
      ['ARM IN ARM', 'SPCEIALTY COCKTAIL'],
      ['Garnish: Edible Flower', 'SPCEIALTY COCKTAIL'],
      ['GIN BASIL SMASH', 'SPCEIALTY COCKTAIL'],
      ['Garnish: Basil sprig', 'SPCEIALTY COCKTAIL'],
      ['Round Taco Insert', 'TRAY'],
    ],
  );
});

test('Pack Out treats a zero-quantity uppercase menu cocktail as an item beneath Specialty Cocktail', () => {
  const snapshot = {
    schemaVersion: 19,
    foodService: [
      { sourceId: 'garnish-heading', itemName: 'GARNISH', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'lemons', itemName: 'Whole Lemons', quantity: 2, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'cocktail-total', itemName: 'SPECIALTY COCKTAIL', quantity: 40, fsType: 'Beverage', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'agave-packout', itemName: 'AGAVE SPICE', quantity: 0, fsType: 'Beverage', subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'equipment-heading', itemName: 'KITCHEN EQUIPMENT', quantity: 0, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'tongs', itemName: 'Tongs', quantity: 1, subEvent: 'S-PO', zoneName: 'Pack Out' },
      { sourceId: 'agave-menu', itemName: 'AGAVE SPICE', quantity: 0, fsType: 'Liquor', notes: 'Tequila GLASS: Rocks GARNISH: Cucumber Slice', subEvent: 'S-MENU', zoneName: 'Menu' },
    ],
    packOutTemplates: [{ key: 'print-36', label: 'Pack Out', documentType: 'po', operationalVisible: true, conditions: [] }],
  };

  assert.deepEqual(
    operationalRows(snapshot, 'po', '', 'print-36').map(({ itemName, quantity, sourceSection }) => [itemName, quantity, sourceSection]),
    [
      ['Whole Lemons', 2, 'GARNISH'],
      ['AGAVE SPICE', 40, 'SPECIALTY COCKTAIL'],
      ['Tongs', 1, 'KITCHEN EQUIPMENT'],
    ],
  );
});

test('Kitchen Pack Out section exports select only the requested operational menu group', () => {
  const foodService = [
    ['PASSED HORS D’OEUVRES', '', ''],
    ['Spicy tuna tartare', 'Seafood', 'Food'],
    ['FIRST COURSE', '', 'Food'],
    ['Lobster panzanella', '', 'Food'],
    ['LATE NIGHT PASSED BITES', '', 'Food'],
    ['Pigs in a blanket', '', 'Food'],
    ['PASSED SWEETS', '', 'Food'],
    ['Carrot cake', '', 'Food'],
    ['ADDITIONAL', '', 'Food'],
    ['Artisanal breads', '', 'Food'],
    ['Young coconut ceviche', 'Vegetable', 'Food'],
    ['RAW BAR STATION', '', 'Food'],
    ['East coast oysters', '', 'Food'],
  ].map(([itemName, category, fsType], index) => ({
    sourceId: `food-${index}`,
    itemName,
    category,
    fsType,
    subEvent: 'S-MENU',
    zoneName: 'Menu',
  }));
  const requiredItems = [
    'Spicy tuna tartare',
    'Lobster panzanella',
    'Pigs in a blanket',
    'Carrot cake',
    'Artisanal breads',
    'Young coconut ceviche',
    'East coast oysters',
  ].map((station, index) => ({
    sourceId: `required-${index}`,
    itemName: `Component ${index}`,
    station,
    fsType: 'Food',
    subEvent: 'S-MENU',
    zoneName: 'Menu',
  }));
  const snapshot = {
    schemaVersion: 18,
    requiredItems,
    foodService,
    packOutTemplates: [{ key: 'print-kpo', documentType: 'kitchen_packout', conditions: [] }],
  };

  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:passed-hds', 'print-kpo').map(({ station }) => station),
    ['Spicy tuna tartare', 'Young coconut ceviche']
  );
  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:dinner', 'print-kpo').map(({ station }) => station),
    ['Lobster panzanella', 'Artisanal breads']
  );
  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:raw-bar-station', 'print-kpo').map(({ station }) => station),
    ['East coast oysters']
  );
});

test('Kitchen Pack Out assigns operational rows that lack a mapped menu dish', () => {
  const snapshot = {
    schemaVersion: 18,
    requiredItems: [
      { sourceId: 'staff', itemName: 'Bread', station: 'Option C: 7.5+ hours', category: 'Staff Meal' },
      { sourceId: 'almonds', itemName: 'Spiced almonds', station: 'Spiced almonds VEGAN, GF, DF' },
      { sourceId: 'raw-decor', itemName: 'RAW BAR STATION DECOR: FRESH LEMONS, SEAWEED', topLevelFoodService: true },
      { sourceId: 'jello', itemName: 'Jello molds (12 pcs): lime, orange, grape, watermelon', topLevelFoodService: true },
      { sourceId: 'tofu', itemName: 'TOFU, heirloom tomato, baby zucchini, summer squash, basil pangrattato', topLevelFoodService: true },
    ],
    foodService: [],
    packOutTemplates: [{ key: 'print-kpo', documentType: 'kitchen_packout', conditions: [] }],
  };

  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:dinner', 'print-kpo').map(({ sourceId }) => sourceId),
    ['staff', 'tofu']
  );
  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:passed-hds', 'print-kpo').map(({ sourceId }) => sourceId),
    ['almonds']
  );
  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:raw-bar-station', 'print-kpo').map(({ sourceId }) => sourceId),
    ['raw-decor']
  );
  assert.deepEqual(
    operationalRows(snapshot, 'kitchen_packout', 'kpo-section:late-night', 'print-kpo').map(({ sourceId }) => sourceId),
    ['jello']
  );
});

test('document-level manual additions are rendered for staff and kitchen menu document types', () => {
  const snapshot = { schemaVersion: 9, staffRequest: [], kitchenMenu: [], kitchenPackOut: [] };
  const additions = [
    { _id: 'staff-one', documentType: 'staff_request', itemName: 'Coat Check', quantity: 2, notes: 'Call at 4 PM' },
    { _id: 'menu-one', documentType: 'kitchen_menu', itemName: 'Fruit Skewers', quantity: 24 },
    { _id: 'annotated-one', documentType: 'annotated_kitchen_menu', itemName: 'Macarons', quantity: 30 },
  ];

  assert.deepEqual(
    operationalRows(snapshot, 'staff_request', '', '', additions)
      .map(({ position, required, comments }) => ({ position, required, comments })),
    [{ position: 'Coat Check', required: 2, comments: 'Call at 4 PM' }]
  );
  assert.equal(operationalRows(snapshot, 'kitchen_menu', '', '', additions)[0].itemName, 'Fruit Skewers');
  assert.equal(operationalRows(snapshot, 'annotated_kitchen_menu', '', '', additions)[0].itemName, 'Macarons');
});

test('a manual Kitchen Menu row appears in the generated Word document', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Manual menu', date: '2026-09-15', externalId: 'E1', meta: {} },
    snapshot: { schemaVersion: 9, kitchenMenu: [], kitchenPackOut: [], staffRequest: [] },
    type: 'kitchen_menu',
    manualAdditions: [{
      _id: 'menu-one',
      documentType: 'kitchen_menu',
      itemName: 'Fruit Skewers',
      quantity: 24,
      notes: 'Added in OCC Decks',
    }],
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');

  assert.match(xml, /MANUAL ADDITIONS/);
  assert.match(xml, /Fruit Skewers/);
  assert.match(xml, /Added in OCC Decks/);
});

test('manual food-service rows in a Pack Out sub-event are used when event required items are empty', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 36, PrintKind: 'EvtReq', Title: 'Pack Out', Condition1: "(FSType = 'Equipment')" },
  ]);
  const rows = catereaseOperationalTemplateRows({
    requiredItems: [],
    foodService: [
      { itemName: 'Lime Wheels', zoneName: 'Pack Out' },
      { itemName: 'Paper plates', zoneName: 'Pack Out' },
    ],
  }, 'print-36', templates);
  assert.deepEqual(rows.map((row) => row.itemName), ['Lime Wheels', 'Paper plates']);
});

test('a manual Pack Out keeps its whole sub-event and excludes headings and invoice rows', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 36, PrintKind: 'EvtReq', Title: 'Pack Out', Condition1: "(FSType = 'Equipment')" },
  ]);
  const rows = catereaseOperationalTemplateRows({
    requiredItems: [],
    foodService: [
      { itemName: 'KITCHEN EQUIPMENT', quantity: 0, subEvent: 'S-PO' },
      { itemName: 'Chef apron', quantity: 3, fsType: 'Equipment', subEvent: 'S-PO' },
      { itemName: 'Panna', quantity: 14, fsType: 'Beverage', subEvent: 'S-PO' },
      { itemName: 'Rentals - Additional', quantity: 1, fsType: 'Equipment', subEvent: 'S-INVOICE', zoneName: 'Invoice' },
    ],
  }, 'print-36', templates);
  assert.deepEqual(rows.map((row) => row.itemName), ['Chef apron', 'Panna']);
});

test('uppercase menu headings do not turn a Menu sub-event into a Pack Out', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 36, PrintKind: 'EvtReq', Title: 'Pack Out', Condition1: "(FSType = 'Equipment')" },
  ]);
  const rows = catereaseOperationalTemplateRows({
    requiredItems: [
      { itemName: 'Chef apron', quantity: 5, fsType: 'Equipment', station: 'UNASSIGNED' },
    ],
    foodService: [
      { itemName: 'PASSED HORS D’OEUVRES', quantity: 0, subEvent: 'S-MENU', zoneName: 'Menu' },
      { itemName: 'ARM IN ARM', quantity: 0, subEvent: 'S-MENU', zoneName: 'Menu' },
      { itemName: 'STAFF MEAL', quantity: 0, subEvent: 'S-MENU', zoneName: 'Menu' },
      { itemName: 'Spicy hamachi taco', quantity: 0, fsType: 'Food', subEvent: 'S-MENU', zoneName: 'Menu' },
    ],
  }, 'print-36', templates);
  assert.deepEqual(rows.map((row) => row.itemName), ['Chef apron']);
});

test('Caterease print templates use PrintKind, all condition slots, and stored grouping rules', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 10, PrintKind: 'MenuPrep', Title: 'Not a Pack Out' },
    { UID: 20, PrintKind: 'EvtReq', Title: 'Pack Out', GroupBy1: 'FSName', Condition1: "(FSType = 'Equipment')", SortOrder: 2 },
    { UID: 30, PrintKind: 'EvtReq', Title: 'Kitchen Pack Out', GroupBy1: 'Category', GroupBy2: 'FSName', Condition2: "(Type = 'Food')", SortOrder: 1 },
  ]);
  assert.deepEqual(templates.map(({ key, label, documentType, groupBy }) => [key, label, documentType, groupBy]), [
    ['print-30', 'Kitchen Pack Out', 'kitchen_packout', ['category', 'station']],
    ['print-20', 'Pack Out', 'po', ['station']],
  ]);
  assert.deepEqual(templates.map(({ label, operationalVisible }) => [label, operationalVisible]), [
    ['Kitchen Pack Out', true],
    ['Pack Out', true],
  ]);
  const rows = [
    { itemName: 'Chafing Dish', fsType: 'Equipment' },
    { itemName: 'Parsley', fsType: 'Food' },
  ];
  assert.deepEqual(catereasePackOutTemplateRows(rows, 'print-20', templates).map((row) => row.itemName), ['Chafing Dish']);
  assert.deepEqual(catereasePackOutTemplateRows(rows, 'print-30', templates).map((row) => row.itemName), ['Parsley']);
});

test('test EvtReq templates stay diagnostic-only and Kitchen Pack Out keeps its document type without a condition', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 1, PrintKind: 'EvtReq', Title: 'Kitchen Pack Out', GroupBy1: 'FSName' },
    { UID: 2, PrintKind: 'EvtReq', Title: 'Test - Required Items', GroupBy1: 'Category' },
  ]);
  assert.deepEqual(templates.map(({ label, documentType, operationalVisible }) => [label, documentType, operationalVisible]), [
    ['Kitchen Pack Out', 'kitchen_packout', true],
    ['Test - Required Items', 'po', false],
  ]);
});

test('required items retain Caterease sub-event identity for separate Pack Out exports', () => {
  const rows = normalizeCatereaseKitchenPackOutRows([
    { UID: '1', ItemName: 'Wine Glass', SubEvtNum: 'S-DINNER', SEDescription: 'Dinner' },
    { UID: '2', ItemName: 'Coupe Glass', SubEvtNum: 'S-COCKTAIL', SEDescription: 'Cocktail Hour' },
  ]);
  assert.deepEqual(rows.map(({ subEvent, zoneName }) => [subEvent, zoneName]), [
    ['S-DINNER', 'Dinner'],
    ['S-COCKTAIL', 'Cocktail Hour'],
  ]);
});

test('required items inherit a sub-event through their Caterease food service name', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E20244',
    packOutRows: [
      { FdSvNum: 'FS1', ItemName: 'Dinner Station', SubEvtNum: 'S-DINNER' },
      { FdSvNum: 'FS2', ItemName: 'Cocktail Station', SubEvtNum: 'S-COCKTAIL' },
    ],
    kitchenPackOutRows: [
      { UID: 'R1', ItemName: 'Dinner Plate', FSName: 'Dinner Station', SEDescription: 'Menu' },
      { UID: 'R2', ItemName: 'Cocktail Napkin', FSName: 'Cocktail Station', SEDescription: 'Menu' },
    ],
  });
  assert.deepEqual(snapshot.requiredItems.map(({ itemName, subEvent, zoneName }) => [itemName, subEvent, zoneName]), [
    ['Dinner Plate', 'S-DINNER', 'Menu'],
    ['Cocktail Napkin', 'S-COCKTAIL', 'Menu'],
  ]);
});

test('required items use FdSvNum when the same food service name appears in multiple sub-events', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E20244',
    packOutRows: [
      { FdSvNum: 'FS1', ItemName: 'Passed HDs', SubEvtNum: 'S-DINNER' },
      { FdSvNum: 'FS2', ItemName: 'Passed HDs', SubEvtNum: 'S-COCKTAIL' },
    ],
    kitchenPackOutRows: [
      { UID: 'R1', FdSvNum: 'FS2', ItemName: 'Cocktail Tray', FSName: 'Passed HDs' },
    ],
  });
  assert.equal(snapshot.requiredItems[0].subEvent, 'S-COCKTAIL');
});

test('required items inherit a missing food type through FdSvNum before template filtering', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22856',
    packOutRows: [{ FdSvNum: 'FS-BLINI', ItemName: 'Blini with caviar', Type: 'Food' }],
    kitchenPackOutRows: [{ UID: 'R1', FdSvNum: 'FS-BLINI', ItemName: 'Caviar', FSName: 'Blini with caviar' }],
    printTemplateRows: [{ UID: 1, PrintKind: 'EvtReq', Title: 'Kitchen Pack Out', Condition2: "(Type = 'Food')" }],
  });
  assert.equal(snapshot.requiredItems[0].fsType, 'Food');
  assert.deepEqual(catereaseOperationalTemplateRows(
    snapshot,
    'print-1',
    snapshot.packOutTemplates
  ).map((row) => row.itemName), ['Caviar']);
});

test('Kitchen Pack Out includes an unexpanded dish but excludes menu headings, staff meal, and beverages', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 1, PrintKind: 'EvtReq', Title: 'Kitchen Pack Out', Condition2: "(Type = 'Food')" },
  ]);
  const requiredItems = Array.from({ length: 15 }, (_, index) => ({
    sourceId: `required-${index}`,
    foodServiceId: `FS-${Math.floor(index / 5) + 1}`,
    itemName: `Ingredient ${index + 1}`,
    station: `Dish ${Math.floor(index / 5) + 1}`,
    subEvent: 'S-MENU',
    fsType: 'Food',
  }));
  const rows = catereaseOperationalTemplateRows({
    requiredItems,
    foodService: [
      { foodServiceId: 'FS-1', itemName: 'Dish 1', subEvent: 'S-MENU', fsType: 'Food' },
      { foodServiceId: 'FS-HEADING', itemName: "PASSED HORS D'OEUVRES", quantity: 0, subEvent: 'S-MENU', fsType: 'Food' },
      { foodServiceId: 'FS-BLINI', itemName: 'Blini with caviar & creme fraiche', subEvent: 'S-MENU', fsType: 'Food', category: 'Seafood' },
      { foodServiceId: 'FS-STAFF', itemName: 'Option A: 5 hours or less', subEvent: 'S-MENU', fsType: 'Food', category: 'Staff Meal' },
      { foodServiceId: 'FS-DRINK', itemName: 'BONFIRE NIGHTS', subEvent: 'S-MENU', fsType: 'Food' },
    ],
    kitchenMenu: [
      { itemName: 'Dish 1', subEvent: 'S-MENU', menuGroup: "PASSED HORS D'OEUVRES" },
      { itemName: 'Blini with caviar & creme fraiche', subEvent: 'S-MENU', menuGroup: "PASSED HORS D'OEUVRES" },
      { itemName: 'Option A: 5 hours or less', subEvent: 'S-MENU', menuGroup: 'STAFF MEAL' },
      { itemName: 'BONFIRE NIGHTS', subEvent: 'S-MENU', menuGroup: 'PASSED BEVERAGES' },
    ],
  }, 'print-1', templates);
  assert.equal(rows.length, 16);
  assert.deepEqual(rows.slice(-1).map(({ itemName, station, topLevelFoodService }) => ({ itemName, station, topLevelFoodService })), [{
    itemName: 'Blini with caviar & creme fraiche',
    station: 'Blini with caviar & creme fraiche',
    topLevelFoodService: true,
  }]);
});

test('Kitchen Pack Out excludes non-food Pack Out rows and mocktails when its live template has no condition', () => {
  const templates = normalizeCatereasePrintTemplates([
    { UID: 6, PrintKind: 'EvtReq', Title: 'Kitchen Pack Out' },
  ]);
  const rows = catereaseOperationalTemplateRows({
    requiredItems: [
      { sourceId: 'food', foodServiceId: 'FS-FOOD', itemName: 'Taro taco shell', station: 'Hamachi taco', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Food' },
      { sourceId: 'test', foodServiceId: 'FS-TEST', itemName: 'Burger Test Item', station: 'Burger', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Food', category: 'Pack Out' },
      { sourceId: 'ice', foodServiceId: 'FS-ICE', itemName: '09 - ICE', station: 'ICE', subEvent: 'S-PO', zoneName: 'Pack Out', fsType: 'Other' },
    ],
    foodService: [
      { sourceId: 'food-dish', foodServiceId: 'FS-FOOD', itemName: 'Hamachi taco', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Food' },
      { sourceId: 'shrimp', foodServiceId: 'FS-SHRIMP', itemName: 'Shrimp cocktail', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Food' },
      { sourceId: 'mocktail', foodServiceId: 'FS-MOCKTAIL', itemName: 'ARM IN ARM', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Liquor' },
      { sourceId: 'staff-heading', foodServiceId: 'FS-STAFF', itemName: 'STAFF MEALS', quantity: 8, subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Food' },
      { sourceId: 'cocktail', foodServiceId: 'FS-COCKTAIL', itemName: 'AGAVE SPICE', subEvent: 'S-MENU', zoneName: 'Menu', fsType: 'Liquor' },
    ],
    kitchenMenu: [
      { itemName: 'Hamachi taco', subEvent: 'S-MENU', menuGroup: "PASSED HORS D'OEUVRES", fsType: 'Food' },
      { itemName: 'Shrimp cocktail', subEvent: 'S-MENU', menuGroup: "PASSED HORS D'OEUVRES", fsType: 'Food' },
      { itemName: 'ARM IN ARM', subEvent: 'S-MENU', menuGroup: 'MOCKTAIL:', fsType: 'Liquor' },
      { itemName: 'STAFF MEALS', subEvent: 'S-MENU', menuGroup: 'PLACED' },
      { itemName: 'AGAVE SPICE', subEvent: 'S-MENU', menuGroup: 'PLACED' },
    ],
  }, 'print-6', templates);

  assert.deepEqual(rows.map((row) => row.itemName), ['Taro taco shell', 'Shrimp cocktail']);
  assert.deepEqual([...new Set(rows.map((row) => row.zoneName))], ['Menu']);
});

test('sub-event descriptions become human document names across operational data', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E20244',
    subEventRows: [
      { SubEvtNum: 'S-DINNER', Description: 'Wedding Dinner' },
      { SubEvtNum: 'S-STAFF', Description: 'Staff Holding' },
    ],
    packOutRows: [
      { FdSvNum: 'FS1', ItemName: 'Dinner', SubEvtNum: 'S-DINNER' },
      { FdSvNum: 'FS2', ItemName: 'Staff Meal', SubEvtNum: 'S-STAFF' },
    ],
    kitchenPackOutRows: [
      { UID: 'R1', FdSvNum: 'FS2', ItemName: 'Paper Plate', FSName: 'Staff Meal', SEDescription: 'Menu' },
    ],
    staffRequestRows: [
      { ShiftNum: 'SH1', SubEvtNum: 'S-STAFF', Position: 'Captain' },
    ],
  });
  assert.deepEqual(snapshot.foodService.map(({ zoneName }) => zoneName), ['Wedding Dinner', 'Staff Holding']);
  assert.equal(snapshot.requiredItems[0].zoneName, 'Staff Holding');
  assert.equal(snapshot.staffRequest[0].zoneName, 'Staff Holding');
});

test('required items are not guessed when a food service name belongs to multiple sub-events', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E20244',
    packOutRows: [
      { FdSvNum: 'FS1', ItemName: 'Passed HDs', SubEvtNum: 'S-DINNER' },
      { FdSvNum: 'FS2', ItemName: 'Passed HDs', SubEvtNum: 'S-COCKTAIL' },
    ],
    kitchenPackOutRows: [
      { UID: 'R1', ItemName: 'Tray', FSName: 'Passed HDs', SEDescription: 'Menu' },
    ],
  });
  assert.equal(snapshot.requiredItems[0].subEvent, '');
});

test('Caterease operational Pack Out rows map to recognized bar items', () => {
  const [item] = catereaseOperationalPackOutToBarItems([{
    sourceId: '42',
    itemName: 'Tito\'s Vodka',
    quantity: 3,
    menuGroup: 'Liquor',
    category: 'Beverages',
    notes: '750 ml bottles',
  }]);
  assert.deepEqual(item, {
    id: 'caterease-operation:42',
    name: 'Tito\'s Vodka',
    section: 'Liquor',
    scope: 'alcohol',
    includedByDefault: true,
    quantity: 3,
    quantityText: '3',
    notes: '750 ml bottles',
    delivered: '',
    returned: '',
  });
});

test('Caterease operational bar item mapping reuses packout scope classification', () => {
  const items = catereaseOperationalPackOutToBarItems([
    { itemName: 'Tito\'s Vodka' },
    { itemName: 'Club Soda' },
    { itemName: 'Kitchen Equipment Cart' },
    { itemName: 'Milano Stainless Steel Champagne Bucket' },
    { itemName: 'Mystery item' },
  ]);
  assert.deepEqual(items.map(({ scope, includedByDefault }) => ({ scope, includedByDefault })), [
    { scope: 'alcohol', includedByDefault: true },
    { scope: 'bar_support', includedByDefault: true },
    { scope: 'non_bar', includedByDefault: false },
    { scope: 'non_bar', includedByDefault: false },
    { scope: 'review', includedByDefault: false },
  ]);
});

test('Caterease operational re-sync preserves recorded bar quantities and state', () => {
  const existing = [{
    _id: 'existing-item-id',
    name: 'Tito\'s Vodka',
    section: 'Liquor',
    scope: 'alcohol',
    included: true,
    sentQty: 2,
    entrySource: 'packout',
    deliveredQty: 2,
    returnedFullQty: 1,
    returnedOpenQty: 0.5,
    lostDamagedQty: 0.25,
    returnConfirmed: true,
    captainNotes: 'One bottle opened',
    clientChargeSnapshot: { unitPrice: 75, lineTotal: 300, source: 'caterease-line-1' },
    prepTask: { scheduledDate: '2026-09-11', completedAt: new Date('2026-09-11T22:00:00Z') },
    updatedBy: 'captain',
    updatedAt: new Date('2026-09-11T22:05:00Z'),
  }];
  const result = runImportedBarItemMergePipeline({
    existingItems: existing,
    importedItems: [{
      name: 'Tito\'s Vodka',
      section: 'Liquor',
      scope: 'alcohol',
      included: true,
      sentQty: 4,
    }],
    documentTypes: ['po'],
    eventDate: '2026-09-11',
    scheduledBy: 'Caterease operational sync',
  });
  const [item] = result.items;
  assert.equal(item.sentQty, 4);
  assert.equal(item.deliveredQty, 2);
  assert.equal(item.returnedFullQty, 1);
  assert.equal(item.returnedOpenQty, 0.5);
  assert.equal(item.lostDamagedQty, 0.25);
  assert.equal(item.returnConfirmed, true);
  assert.equal(item.captainNotes, 'One bottle opened');
  assert.deepEqual(item.clientChargeSnapshot, { unitPrice: 75, lineTotal: 300, source: 'caterease-line-1' });
  assert.equal(item.prepTask.completedAt.toISOString(), '2026-09-11T22:00:00.000Z');
  assert.equal(item.updatedBy, 'captain');
  assert.equal(String(item._id), 'existing-item-id');
});

test('unchanged Caterease operational snapshots are applied only once to a BarEvent', () => {
  const barEvent = {
    revision: 8,
    audit: [
      { action: 'caterease_operations_synced', details: { checksum: 'checksum-a', barItemsVersion: CATEREASE_OPERATIONAL_BAR_ITEMS_VERSION } },
      { action: 'returns_saved', details: {} },
      { action: 'caterease_operations_synced', details: { checksum: 'checksum-b', barItemsVersion: CATEREASE_OPERATIONAL_BAR_ITEMS_VERSION } },
      { action: 'captain_notes_saved', details: {} },
    ],
  };
  assert.equal(hasAppliedCatereaseOperationalChecksum(barEvent, 'checksum-b'), true);
  assert.equal(hasAppliedCatereaseOperationalChecksum(barEvent, 'checksum-a'), false);
  assert.equal(hasAppliedCatereaseOperationalChecksum(barEvent, ''), false);
  assert.equal(hasAppliedCatereaseOperationalChecksum({ audit: [] }, 'checksum-b'), false);
  assert.equal(hasAppliedCatereaseOperationalChecksum({
    audit: [{ action: 'caterease_operations_synced', details: { checksum: 'checksum-b' } }],
  }, 'checksum-b'), false);
});

test('an unchanged operational snapshot still repairs a missing Bar Operations guest count', () => {
  assert.equal(shouldUpdateCatereaseOperationalGuestCount({
    guestCount: null,
    guestCountSource: 'dashboard',
  }, 180, 'packout'), true);
  assert.equal(shouldUpdateCatereaseOperationalGuestCount({
    guestCount: 180,
    guestCountSource: 'packout',
  }, 180, 'packout'), false);
  assert.equal(shouldUpdateCatereaseOperationalGuestCount({
    guestCount: 120,
    guestCountSource: 'manual',
  }, 180, 'packout'), false);
  assert.equal(shouldUpdateCatereaseOperationalGuestCount({
    guestCount: 0,
    guestCountSource: 'manual',
  }, 180, 'packout'), true);
});

test('Caterease Pack Out rows preserve operational grouping', () => {
  const rows = normalizeCatereasePackOutRows([{
    UID: 42,
    ItemNum: 'MI-1',
    ItemName: 'C-folds',
    Qty: 4,
    Unit: 'Each',
    PrepArea: 'Operations',
    SubEvtNum: '00001-S1',
    Category: 'Paper goods',
    MenuGroup: 'Kitchen Equipment',
    UseRecipe: false,
  }]);

  assert.deepEqual(rows[0], {
    sourceId: '42',
    foodServiceId: '',
    itemId: 'MI-1',
    itemName: 'C-folds',
    quantity: 4,
    unit: 'Each',
    prepArea: 'Operations',
    subEvent: '00001-S1',
    zoneName: '',
    category: 'Paper goods',
    fsType: '',
    menuGroup: 'Kitchen Equipment',
    useRecipe: false,
    notes: '',
  });
});

test('Caterease Pack Out suppresses a description that only repeats the item name', () => {
  const rows = normalizeCatereasePackOutRows([
    { ItemName: 'Chef apron', Description: 'Chef apron' },
    { ItemName: 'Mixing Bowl- Medium' },
    { ItemName: 'Mixing Bowl- Large', Description: 'Mixing Bowl- Medium' },
    { ItemName: 'Simple Syrup - QUART', Description: 'Simple Syrup' },
    { ItemName: 'Garnish for Specialty: Mint sprig', Description: 'Garnish' },
    { ItemName: 'Gloves- S, M, L', Comment: 'of each' },
    { ItemName: 'Square black inserts', Description: 'NEW INSERTS OR BEST CONDITION' },
  ]);
  assert.deepEqual(rows.map((row) => row.notes), [
    '', '', '', '', '', 'of each', 'NEW INSERTS OR BEST CONDITION',
  ]);
});

test('Caterease Pack Out excludes non-inventory Standard service rows', () => {
  const rows = normalizeCatereasePackOutRows([
    { ItemName: 'Food', Qty: 12, MenuGroup: 'Standard' },
    { ItemName: 'C-folds', Qty: 2, MenuGroup: 'Kitchen Equipment' },
  ]);
  assert.deepEqual(rows.map((row) => row.itemName), ['C-folds']);
});

test('operational snapshot keeps guest count from the Standard Food service row', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'Food', Qty: 12, MenuGroup: 'Standard' }],
  });
  assert.equal(snapshot.guestCount, 12);
  assert.equal(snapshot.packOut.length, 0);
});

test('operational snapshot uses Caterease guest fields without a Standard Food row', () => {
  const rows = [
    { ItemName: 'Club Soda', Qty: 2, PlnGuests: 150, GtdGuests: 120, ActGuests: 0 },
    { ItemName: 'Tito\'s Vodka', Qty: 4, PlnGuests: 150, GtdGuests: 120, ActGuests: 0 },
  ];
  const snapshot = buildCatereaseOperationalSnapshot({ eventId: 'E22672', packOutRows: rows });
  assert.equal(snapshot.guestCount, 120);
  assert.equal(catereaseOperationalGuestCount(rows), 120);
});

test('operational snapshot keeps event-level Caterease details and service timing', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22856',
    eventRow: {
      ActGuests: '40        ',
      GtdGuests: null,
      PlnGuests: null,
      SalesRep: 'Olivier Cheng',
      Client: 'Studio Sully Event Production & Design',
      Status: 'Definite',
      Category: "Passed HD's",
    },
    packOutRows: [{ ItemName: 'Club Soda', Qty: 2 }],
    subEventRows: [
      { SubEvtNum: 'S-STAFF', Description: 'Staffing', StartTime: '12:00:00', EndTime: '03:00:00' },
      { SubEvtNum: 'S-INVOICE', Description: 'Invoice', StartTime: '16:00:00', EndTime: '02:00:00' },
    ],
  });
  assert.equal(snapshot.guestCount, 40);
  assert.equal(snapshot.salesRep, 'Olivier Cheng');
  assert.equal(snapshot.client, 'Studio Sully Event Production & Design');
  assert.equal(snapshot.eventStatus, 'Definite');
  assert.equal(snapshot.eventType, "Passed HD's");
  assert.equal(snapshot.eventStartTime, '16:00:00');
  assert.equal(snapshot.eventEndTime, '02:00:00');
});

test('Caterease actual guests override planned guests and respect a larger guarantee', () => {
  assert.equal(catereaseOperationalGuestCount([{ PlnGuests: 150, GtdGuests: 120, ActGuests: 130 }]), 130);
  assert.equal(catereaseOperationalGuestCount([{ PlnGuests: 150, GtdGuests: 140, ActGuests: 130 }]), 140);
  assert.equal(catereaseOperationalGuestCount([{ PlnGuests: 150, GtdGuests: 0, ActGuests: 0 }]), 150);
});

test('Caterease Kitchen Pack Out rows preserve required item details', () => {
  const rows = normalizeCatereaseKitchenPackOutRows([{
    UID: 42,
    ItemName: 'Green apple mousse',
    Qty: 120,
    Unit: 'Each',
    PUnit: 'Case',
    QtyPerPUnit: 12,
    FSPrepArea: 'Pastry',
    FSName: 'Caramel Apple',
  }]);
  assert.equal(rows[0].itemName, 'Green apple mousse');
  assert.equal(rows[0].station, 'Caramel Apple');
  assert.equal(rows[0].prepArea, 'Pastry');
  assert.equal(rows[0].purchaseUnit, 'Case');
});

test('Caterease operational rows preserve sub-event names for separate document exports', () => {
  const [packOut] = normalizeCatereasePackOutRows([{
    ItemName: 'Club Soda',
    Qty: 2,
    SubEvtNum: 'S1',
    SEDescription: 'Green Room',
  }]);
  const [kitchenPackOut] = normalizeCatereaseKitchenPackOutRows([{
    ItemName: 'Cutting Board',
    Qty: 1,
    SEDescription: 'Staff Holding',
  }]);
  assert.equal(packOut.zoneName, 'Green Room');
  assert.equal(kitchenPackOut.zoneName, 'Staff Holding');
});

test('Caterease shifts become Staff Request rows', () => {
  const [row] = normalizeCatereaseStaffRequestRows([{
    ShiftNum: 'SHIFT-1',
    SubEvtNum: 'S1',
    Position: 'Captain',
    Required: 2,
    StartTime: '16:00',
    EndTime: '23:00',
    Uniform: 'Black suit',
  }]);
  assert.deepEqual(row, {
    sourceId: 'SHIFT-1',
    subEvent: 'S1',
    zoneName: '',
    position: 'Captain',
    required: 2,
    startTime: '16:00',
    endTime: '23:00',
    category: '',
    comments: '',
    uniform: 'Black suit',
  });
});

test('operational DOCX exports only the requested sub-event', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    eventRow: {
      Extra10: '04:00 PM',
      Extra13: '06:00 PM',
      Extra14: '08:00 PM',
      Revised: '2026-09-10T19:53:38.57',
    },
    packOutRows: [
      { ItemName: 'Green Room Ice', Qty: 2, SubEvtNum: 'S1', SEDescription: 'Green Room' },
      { ItemName: 'Staff Holding Water', Qty: 4, SubEvtNum: 'S2', SEDescription: 'Staff Holding' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: { eventTime: '4:00 pm – 9:00 pm' } },
    snapshot,
    type: 'po',
    zoneKey: 's1|green room',
    zoneName: 'Green Room',
    includePackOutTemplate: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const text = docxText(xml);
  assert.match(xml, /Green Room Ice/);
  assert.doesNotMatch(xml, /Staff Holding Water/);
  assert.doesNotMatch(xml, />PACK OUT</);
  assert.match(text, /Event Timing: 6:00 pm - 8:00 pm/);
  assert.match(text, /Delivery Time: 4:00 pm/);
  assert.match(text, /Date PO Modified: 9\/10\/2026 \(7:53 pm\)/);
  assert.match(xml, /<w:color w:val="FF0000"\/[^>]*>/);
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="28"\/><w:szCs w:val="28"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Event: <\/w:t>/);
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="28"\/><w:szCs w:val="28"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Dinner<\/w:t>/);
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="20"\/><w:szCs w:val="20"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Friday, September 11, 2026<\/w:t>/);
  assert.doesNotMatch(xml, /<w:color w:val="FF0000"\/>.*?<w:t xml:space="preserve">PACK OUT<\/w:t>/s);
  assert.match(xml, /<w:jc w:val="right"\/>.*?<w:t xml:space="preserve">Revision<\/w:t>/s);
  assert.doesNotMatch(xml, />Photo</);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 2, 'Caterease PO uses one event table and one continuous item table');
  assert.match(xml, /<w:gridSpan w:val="5"\/[^>]*>/);
});

test('operational DOCX uses event-level Caterease guests and sales rep', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-14', externalId: 'E22856', meta: {} },
    snapshot: {
      schemaVersion: 18,
      guestCount: 40,
      salesRep: 'Olivier Cheng',
      packOut: [{ itemName: 'Club Soda', quantity: 2 }],
      kitchenPackOut: [],
      kitchenMenu: [],
      staffRequest: [],
    },
    type: 'po',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const text = docxText(xml);
  assert.match(text, /Sales Rep: Olivier Cheng/);
  assert.match(text, /Guests: 40/);
});

test('operational DOCX filters shared sub-event rows by their human zone description', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [
      { ItemName: 'Green Room Ice', Qty: 2, SubEvtNum: 'S1', SEDescription: 'Green Room' },
      { ItemName: 'Staff Holding Water', Qty: 4, SubEvtNum: 'S1', SEDescription: 'Staff Holding' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
    snapshot,
    type: 'po',
    zoneKey: 's1|staff holding',
    zoneName: 'Staff Holding',
    includePackOutTemplate: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Staff Holding Water/);
  assert.doesNotMatch(xml, /Green Room Ice/);
});

test('operational DOCX separates different sub-events with the same human description', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E20244',
    packOutRows: [
      { ItemName: 'Dinner Wine', Qty: 2, SubEvtNum: 'S-DINNER', SEDescription: 'Menu' },
      { ItemName: 'Cocktail Ice', Qty: 4, SubEvtNum: 'S-COCKTAIL', SEDescription: 'Menu' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Wedding', date: '2026-09-12', externalId: 'E20244', meta: {} },
    snapshot,
    type: 'po',
    zoneKey: 's-dinner|menu',
    zoneName: 'Menu 1',
    includePackOutTemplate: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Dinner Wine/);
  assert.doesNotMatch(xml, /Cocktail Ice/);
});

test('Kitchen Pack Out uses the Caterease feedback table layout', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    eventRow: {
      Address1: '1000 Third Avenue', City: 'New York', StProv: 'NY', Postal: '10022',
    },
    packOutRows: [{
      ItemName: 'STAFF MEALS', Qty: 8, FSType: 'Food', FdSvNum: 'FS-STAFF-TOTAL', SubEvtNum: 'S-MENU',
    }, {
      ItemName: 'Option A: 5 hours or less', Qty: 0, Notes: 'Peanut butter & jelly sandwiches', FSType: 'Food', FdSvNum: 'FS-STAFF', SubEvtNum: 'S-MENU',
    }],
    kitchenPackOutRows: [
      { ItemName: 'Bread', Qty: 2, Unit: 'Loaf', FSName: 'Option A: 5 hours or less', FSType: 'Food', FdSvNum: 'FS-STAFF' },
      { ItemName: 'Sheet Pan', Qty: 3, Unit: 'Each', FSName: 'Hot Line', FSPrepArea: 'Kitchen' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
    snapshot,
    type: 'kitchen_packout',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />Kitchen Pack Out</);
  assert.match(xml, />Event Name: </);
  assert.match(xml, />Guest Count: </);
  assert.match(xml, /Address: 1000 Third Avenue New York, NY 10022/);
  assert.match(xml, /Event Date: 09\/11\/2026/);
  assert.match(xml, /Staff Meal: 8 - Option A: 5 hours or less/);
  assert.doesNotMatch(xml, /Staff Meal: 0/);
  assert.match(xml, />Staff Meal</);
  assert.match(xml, />Option A: 5 hours or less - Peanut butter &amp; jelly sandwiches</);
  assert.ok(xml.indexOf('>Staff Meal<') > xml.indexOf('>Hot Line<'));
  assert.doesNotMatch(xml, />Revision</);
  assert.match(xml, />Quantity</);
  assert.match(xml, />Not Enough</);
  assert.match(xml, />Just Enough</);
  assert.match(xml, />Too Much</);
  assert.doesNotMatch(xml, />Delivered</);
  assert.doesNotMatch(xml, />Returned</);
  assert.match(xml, />Hot Line</);
  assert.match(xml, />Sheet Pan</);
  assert.doesNotMatch(xml, />3</);
});

test('manual Pack Out comments are preserved in the Word notes column', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22856',
    packOutRows: [{ ItemName: 'Gloves- S, M, L', Qty: 1, Comment: 'of each', SEDescription: 'Pack Out' }],
    printTemplateRows: [{ UID: 36, PrintKind: 'EvtReq', Title: 'Pack Out', Condition1: "(FSType = 'Equipment')" }],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-14', externalId: 'E22856', meta: {} },
    snapshot,
    type: 'po',
    templateKey: 'print-36',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />Gloves- S, M, L</);
  assert.match(xml, />of each</);
});

test('operational DOCX applies a selected Caterease Pack Out template', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Chafing Dish', Qty: 2, Unit: 'Each', FSType: 'Equipment', FSName: 'Buffet' },
      { ItemName: 'Bread', Qty: 12, Unit: 'Each', FSType: 'Food', FSName: 'Bread Service' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
    snapshot,
    type: 'po',
    templateKey: 'pack_out',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.doesNotMatch(xml, />PACK OUT</);
  assert.match(xml, />BUFFET</);
  assert.match(xml, /Chafing Dish/);
  assert.doesNotMatch(xml, />Bread</);
});

test('Staff Request DOCX is generated from Caterease shifts', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    staffRequestRows: [{ ShiftNum: '1', Position: 'Captain', Required: 2, StartTime: '16:00', EndTime: '23:00' }],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
    snapshot,
    type: 'staff_request',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /STAFF REQUEST FORM/);
  assert.match(xml, /Captain/);
  assert.match(xml, /4:00 pm/);
  assert.match(xml, /11:00 pm/);
  assert.match(xml, />Hours</);
  assert.match(xml, />7</);
  assert.match(xml, /TOTAL STAFF NEEDED/);
});

test('Staff Request XLSX matches the Caterease staffing sheet fields', async () => {
  const buffer = await renderCatereaseStaffRequestXlsx({
    event: {
      title: 'Chanel YPO Cocktail',
      date: '2026-09-14',
      externalId: 'E22856 - S62650',
      meta: { eventTime: '4:30 pm - 9:30 pm' },
    },
    snapshot: {
      guestCount: 40,
      salesRep: 'Olivier Cheng',
      eventStatus: 'Definite',
      eventType: "Passed HD's",
      eventStartTime: '18:30:00',
      eventEndTime: '20:00:00',
      staffRequest: [
        { subEvent: 'S1', zoneName: 'Staffing', position: 'Captain - Working', required: 1, startTime: '16:30:00', endTime: '21:30:00' },
        { subEvent: 'S1', zoneName: 'Staffing', position: 'Food Passer', required: 1, startTime: '16:30:00', endTime: '21:30:00', uniform: 'Wht BttnDwn Shrt-Blk Tie (OC)' },
        { subEvent: 'S2', zoneName: 'Other', position: 'Excluded', required: 9, startTime: '10:00:00', endTime: '11:00:00' },
      ],
    },
    zoneKey: 's1|staffing',
    manualAdditions: [{
      _id: 'manual-staff',
      documentType: 'staff_request',
      zoneKey: 's1|staffing',
      itemName: 'Coat Check',
      quantity: 2,
      notes: 'Call at 4 PM',
    }],
  });
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.match(workbook, /name="Sheet1"/);
  assert.match(sheet, /Chanel YPO Cocktail/);
  assert.match(sheet, /Olivier Cheng/);
  assert.match(sheet, /Definite/);
  assert.match(sheet, /Passed HD&apos;s/);
  assert.match(sheet, /6:30 pm – 8:00 pm/);
  assert.doesNotMatch(sheet, /4:30 pm - 9:30 pm/);
  assert.match(sheet, /<c r="C9" s="6"><v>0\.6875<\/v><\/c>/);
  assert.match(sheet, /<c r="D31" s="6"><v>0\.8958333333333334<\/v><\/c>/);
  assert.match(sheet, />Hours</);
  assert.match(sheet, />5</);
  assert.match(sheet, /Wht BttnDwn Shrt-Blk Tie \(OC\)/);
  assert.match(sheet, /Coat Check/);
  assert.match(sheet, /Call at 4 PM/);
  assert.match(sheet, /TOTAL STAFF NEEDED/);
  assert.match(sheet, /<sheetFormatPr baseColWidth="10" defaultRowHeight="16"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="19\.33203125" customWidth="1"\/>/);
  assert.match(sheet, /<mergeCell ref="A2:A3"\/>/);
  assert.match(sheet, /<mergeCell ref="A12:A13"\/>/);
  assert.match(sheet, /<mergeCell ref="B12:B13"\/>/);
  assert.match(styles, /<name val="Helvetica"\/>/);
  assert.doesNotMatch(styles, /<left style=/);
  assert.doesNotMatch(sheet, /Excluded/);
});

test('Kitchen Menu contains one dish per Kitchen Pack Out station', () => {
  const rows = buildKitchenMenuRows([
    { station: 'Caramel Apple', prepArea: 'Pastry', itemName: 'Mousse' },
    { station: 'Caramel Apple', prepArea: 'Pastry', itemName: 'Apple center' },
    { station: 'Option C: 7.5+ hours', prepArea: 'Staff', itemName: 'Cook' },
  ]);
  assert.deepEqual(rows.map(({ itemName, prepArea, componentCount }) => ({ itemName, prepArea, componentCount })), [
    { itemName: 'Caramel Apple', prepArea: 'Pastry', componentCount: 2 },
  ]);
});

test('Kitchen Menu keeps the same dish in separate Caterease sub-events', () => {
  const rows = buildKitchenMenuRows([
    { itemName: 'Dinner plate', station: 'Passed HDs', subEvent: 'S-DINNER', zoneName: 'Menu' },
    { itemName: 'Cocktail plate', station: 'Passed HDs', subEvent: 'S-COCKTAIL', zoneName: 'Menu' },
  ]);
  assert.deepEqual(rows.map(({ itemName, subEvent }) => [itemName, subEvent]), [
    ['Passed HDs', 'S-DINNER'],
    ['Passed HDs', 'S-COCKTAIL'],
  ]);
});

test('Caterease food service rows preserve Kitchen Menu dish details', () => {
  const rows = normalizeCatereaseKitchenMenuDishRows([{
    FdSvNum: 17,
    ItemName: 'Caramel Apple',
    Qty: 12,
    PrepArea: 'Pastry',
    Category: 'Dessert',
    Comment: 'Plate cold.',
  }]);
  assert.deepEqual(rows[0], {
    sourceId: '17',
    itemName: 'Caramel Apple',
    quantity: 12,
    unit: '',
    prepArea: 'Pastry',
    subEvent: '',
    zoneName: '',
    category: 'Dessert',
    fsType: '',
    menuGroup: '',
    description: '',
    notes: 'Plate cold.',
  });
});

test('Kitchen Menu follows sequential Caterease section headings within each sub-event', () => {
  const rows = normalizeCatereaseKitchenMenuDishRows([
    { FdSvNum: '4', SubEvtNum: 'S-MENU', ItemName: "PASSED HORS D'OEUVRES", Qty: 0 },
    { FdSvNum: '5', SubEvtNum: 'S-MENU', ItemName: 'Spicy tuna tartare', Category: 'Seafood' },
    { FdSvNum: '7', SubEvtNum: 'S-MENU', ItemName: 'Blini with caviar', Qty: 0, Category: 'Seafood' },
    { FdSvNum: '9', SubEvtNum: 'S-MENU', ItemName: 'STAFF MEAL', Qty: 0 },
    { FdSvNum: '10', SubEvtNum: 'S-MENU', ItemName: 'Option A: 5 hours or less', Qty: 8 },
    { FdSvNum: '12', SubEvtNum: 'S-MENU', ItemName: 'PASSED BEVERAGES', Qty: 0 },
    { FdSvNum: '18', SubEvtNum: 'S-MENU', ItemName: 'BONFIRE NIGHTS', Qty: 0, Description: 'Tequila, mezcal and citrus', Comment: 'NO MEZCAL' },
    { FdSvNum: '19', SubEvtNum: 'S-MENU', ItemName: 'BOURBON MINT SMASH', Qty: 0, Description: 'Bourbon, mint and lemon' },
  ]);

  assert.deepEqual(rows.map(({ itemName, menuGroup }) => [itemName, menuGroup]), [
    ['Spicy tuna tartare', "PASSED HORS D'OEUVRES"],
    ['Blini with caviar', "PASSED HORS D'OEUVRES"],
    ['Option A: 5 hours or less', 'STAFF MEAL'],
    ['BONFIRE NIGHTS', 'PASSED BEVERAGES'],
    ['BOURBON MINT SMASH', 'PASSED BEVERAGES'],
  ]);
  assert.equal(rows[3].notes, 'NO MEZCAL');
});

test('operational snapshot keeps direct Kitchen Menu rows missing from required items', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22856',
    subEventRows: [{ SubEvtNum: 'S-MENU', Description: 'Menu' }],
    packOutRows: [{ FdSvNum: '5', SubEvtNum: 'S-MENU', ItemName: 'Spicy tuna tartare' }],
    kitchenPackOutRows: [
      { UID: 'R1', FdSvNum: '5', ItemName: 'Crispy rice cake', FSName: 'Spicy tuna tartare' },
    ],
    kitchenMenuRows: [
      { FdSvNum: '4', SubEvtNum: 'S-MENU', ItemName: "PASSED HORS D'OEUVRES", Qty: 0 },
      { FdSvNum: '5', SubEvtNum: 'S-MENU', ItemName: 'Spicy tuna tartare', Category: 'Seafood' },
      { FdSvNum: '7', SubEvtNum: 'S-MENU', ItemName: 'Blini with caviar', Qty: 0, Category: 'Seafood' },
      { FdSvNum: '9', SubEvtNum: 'S-MENU', ItemName: 'STAFF MEAL', Qty: 0 },
      { FdSvNum: '10', SubEvtNum: 'S-MENU', ItemName: 'Option A: 5 hours or less', Qty: 8 },
      { FdSvNum: '12', SubEvtNum: 'S-MENU', ItemName: 'PASSED BEVERAGES', Qty: 0 },
      { FdSvNum: '18', SubEvtNum: 'S-MENU', ItemName: 'BONFIRE NIGHTS', Qty: 0, Description: 'Tequila and citrus', Comment: 'NO MEZCAL' },
    ],
  });

  assert.deepEqual(snapshot.kitchenMenu.map(({ itemName, menuGroup }) => [itemName, menuGroup]), [
    ['Spicy tuna tartare', "PASSED HORS D'OEUVRES"],
    ['Blini with caviar', "PASSED HORS D'OEUVRES"],
    ['Option A: 5 hours or less', 'STAFF MEAL'],
    ['BONFIRE NIGHTS', 'PASSED BEVERAGES'],
  ]);
  assert.equal(snapshot.kitchenMenu[0].componentCount, 1);
});

test('Kitchen Menu excludes food-service rows from an Invoice sub-event', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22856',
    subEventRows: [
      { SubEvtNum: 'S-MENU', Description: 'Menu' },
      { SubEvtNum: 'S-INVOICE', Description: 'Invoice' },
    ],
    kitchenMenuRows: [
      { FdSvNum: '1', SubEvtNum: 'S-MENU', ItemName: 'Blini with caviar' },
      { FdSvNum: '2', SubEvtNum: 'S-INVOICE', ItemName: 'Passed HDs - Select 3', Qty: 40 },
      { FdSvNum: '3', SubEvtNum: 'S-INVOICE', ItemName: 'Rentals - Additional', Qty: 1 },
    ],
  });

  assert.deepEqual(snapshot.kitchenMenu.map((row) => row.itemName), ['Blini with caviar']);
});

test('Caterease Kitchen Menu converts rich text fields to plain text', () => {
  const rows = normalizeCatereaseKitchenMenuDishRows([{
    ItemName: 'Caramel Apple',
    Description: String.raw`{\rtf1\ansi\uc1\pard\plain\fs20 Plate cold.\par Add garnish.}`,
  }]);
  assert.equal(rows[0].description, 'Plate cold. Add garnish.');
});

test('operational snapshot separates Kitchen Pack Out components from Kitchen Menu dishes', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Mousse', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
      { ItemName: 'Apple center', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
    ],
  });
  assert.equal(snapshot.kitchenPackOut.length, 2);
  assert.equal(snapshot.kitchenMenu.length, 1);
  assert.equal(snapshot.kitchenMenu[0].itemName, 'Caramel Apple');
});

test('Kitchen Menu merges Kitchen Pack Out dishes with additional food service rows', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Mousse', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
      { ItemName: 'Apple center', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
    ],
    kitchenMenuRows: [{ ItemName: 'Passed Sweets, select 2', Description: String.raw`{\rtf1\ansi Generic group}` }],
  });
  assert.deepEqual(snapshot.kitchenMenu.map((row) => row.itemName), ['Passed Sweets, select 2', 'Caramel Apple']);
  assert.equal(snapshot.kitchenMenu[1].componentCount, 2);
});

test('Kitchen Menu keeps exact Caterease dish quantity while using packout components', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Mousse', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
      { ItemName: 'Apple center', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
    ],
    kitchenMenuRows: [{ ItemName: 'Caramel Apple', Qty: 150, Comment: 'Plate cold.' }],
  });
  assert.equal(snapshot.kitchenMenu.length, 1);
  assert.equal(snapshot.kitchenMenu[0].quantity, 150);
  assert.equal(snapshot.kitchenMenu[0].notes, 'Plate cold.');
  assert.equal(snapshot.kitchenMenu[0].components.length, 2);
});

test('operational snapshot checksum is stable when API row order changes', () => {
  const first = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'B', Qty: 2 }, { ItemName: 'A', Qty: 1 }],
    syncedAt: new Date('2026-09-11T12:00:00Z'),
  });
  assert.equal(first.schemaVersion, 22);
  const second = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'A', Qty: 1 }, { ItemName: 'B', Qty: 2 }],
    syncedAt: new Date('2026-09-11T13:00:00Z'),
  });
  assert.equal(first.checksum, second.checksum);
});

test('Annotated Kitchen Menu DOCX uses dish names and matched Caterease instructions', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: {
      title: 'Dinner',
      date: '2026-09-11',
      externalId: 'E22672',
      meta: { nowsta: { uniform: 'Black', shifts: [{ position: 'Captain', startTime: '3:00 PM', endTime: '10:00 PM', workers: [{}], unfilled: 0 }] } },
    },
    snapshot: {
      schemaVersion: 3,
      kitchenMenu: [{
        itemName: 'Caramel Apple',
        prepArea: 'Pastry',
        componentCount: 2,
        components: [{ name: 'Apple mousse', quantity: 12, unit: 'Each' }],
      }],
    },
    recipes: [{
      name: 'Caramel Apple',
      instructions: 'Temper apples before service.',
      ingredients: [{ name: 'Green apple puree', quantity: 3, unit: 'lb' }],
    }],
    type: 'annotated_kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /KITCHEN MENU/);
  assert.match(xml, /Caramel Apple/);
  assert.match(xml, /Temper apples before service/);
  assert.match(xml, /Label \(OCC; Rentals\)/);
  assert.match(xml, />Comment</);
  assert.match(xml, /STAFFING INFO/);
  assert.match(xml, /Captain/);
  assert.match(xml, /Black/);
  assert.doesNotMatch(xml, /Green apple puree/);
  assert.ok((xml.match(/<w:tbl>/g) || []).length >= 2, 'metadata and menu must both use tables');
});

test('Kitchen Menu DOCX does not render packout components as menu dishes', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Mousse', Qty: 12, Unit: 'Each', FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
      { ItemName: 'Apple center', Qty: 6, Unit: 'Each', FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672' },
    snapshot,
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Caramel Apple/);
  assert.doesNotMatch(xml, />Mousse</);
  assert.doesNotMatch(xml, />Apple center</);
});

test('Kitchen Pack Out fills an unexpanded food-service dish from its exact Caterease recipe', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-14', externalId: 'E22856' },
    snapshot: {
      schemaVersion: 17,
      packOutTemplates: [{
        key: 'print-6',
        label: 'Kitchen Pack Out',
        documentType: 'kitchen_packout',
        supported: true,
        groupBy: ['station'],
        conditions: [],
      }],
      requiredItems: [{ itemName: 'Tuna tartare', station: 'Spicy tuna tartare' }],
      foodService: [
        { itemName: 'Spicy tuna tartare', fsType: 'Food' },
        { itemName: 'Blini with caviar & creme fraiche', fsType: 'Food', category: 'Seafood' },
      ],
      kitchenMenu: [
        { itemName: 'Spicy tuna tartare', category: 'Passed Hors D\u2019oeuvres' },
        { itemName: 'Blini with caviar & creme fraiche', category: 'Passed Hors D\u2019oeuvres' },
      ],
    },
    recipes: [{
      name: 'Blini with caviar & creme fraiche',
      ingredients: [
        { name: 'Wet blini mix \u2013 Eggs', quantity: 1, unit: 'Each' },
        { name: 'Caviar \u2013 1 jar', quantity: 1, unit: 'Jar' },
      ],
    }],
    type: 'kitchen_packout',
    templateKey: 'print-6',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />Spicy tuna tartare</);
  assert.match(xml, />Tuna tartare</);
  assert.match(xml, />Blini with caviar &amp; creme fraiche</);
  assert.match(xml, />Wet blini mix \u2013 Eggs</);
  assert.match(xml, />Caviar \u2013 1 jar</);
  assert.doesNotMatch(xml, /<w:t xml:space="preserve">1<\/w:t>/);
});

test('Kitchen Pack Out does not expand a catalog recipe when Caterease disables UseRecipe', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-16', externalId: 'E22842' },
    snapshot: {
      schemaVersion: 20,
      packOutTemplates: [{
        key: 'print-6',
        label: 'Kitchen Pack Out',
        documentType: 'kitchen_packout',
        supported: true,
        groupBy: ['station'],
        conditions: [],
      }],
      requiredItems: [],
      foodService: [{
        itemName: 'Lemon parmesan arancini',
        fsType: 'Food',
        category: 'Passed Hors D\u2019oeuvres',
        useRecipe: false,
      }],
      kitchenMenu: [{
        itemName: 'Lemon parmesan arancini',
        category: 'Passed Hors D\u2019oeuvres',
      }],
    },
    recipes: [{
      name: 'Lemon parmesan arancini',
      ingredients: [{ name: 'Lemons', quantity: 4, unit: 'Each' }],
    }],
    type: 'kitchen_packout',
    templateKey: 'print-6',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />Lemon parmesan arancini</);
  assert.doesNotMatch(xml, />Lemons</);
});

test('Kitchen Menu keeps Caterease comments in the standard four-column table', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672' },
    snapshot: {
      schemaVersion: 3,
      kitchenPackOut: [],
      kitchenMenu: [{ itemName: 'Caramel Apple', quantity: 12, category: 'Dessert', notes: 'Plate cold.' }],
    },
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />KITCHEN MENU</);
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="28"\/><w:szCs w:val="28"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Dinner<\/w:t>/);
  assert.match(xml, />Qty</);
  assert.match(xml, />Item</);
  assert.match(xml, />Comment</);
  assert.match(xml, /Label \(OCC; Rentals\)/);
  assert.match(xml, />Plate cold\.</);
});

test('Kitchen Menu renders plural beverage sections, hides zero quantities, and removes repeated item prefixes', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-14', externalId: 'E22856' },
    snapshot: {
      schemaVersion: 15,
      kitchenPackOut: [],
      kitchenMenu: [
        {
          itemName: 'BONFIRE NIGHTS',
          quantity: 0,
          menuGroup: 'PASSED BEVERAGES',
          description: 'BONFIRE NIGHTS Mezcal, Tequila, Fresh Grapefruit',
          notes: 'NO MEZCAL',
        },
        { itemName: 'ARM IN ARM', quantity: null, menuGroup: 'MOCKTAILS' },
        { itemName: 'Sancerre', quantity: 0, menuGroup: 'WINE' },
      ],
    },
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />BEVERAGE</);
  assert.match(xml, />PASSED BEVERAGES</);
  assert.match(xml, />Mezcal, Tequila, Fresh Grapefruit</);
  assert.match(xml, />NO MEZCAL</);
  assert.match(xml, />ARM IN ARM</);
  assert.match(xml, />Sancerre</);
  assert.doesNotMatch(xml, />BONFIRE NIGHTS Mezcal/);
  assert.doesNotMatch(xml, /<w:t xml:space="preserve">0<\/w:t>/);
});

test('Kitchen Menu keeps liquor and its garnish in a separate Beverage section', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22646',
    eventRow: { Revised: '2026-09-16T15:58:46' },
    subEventRows: [{ SubEvtNum: 'S-MENU', Description: 'Menu' }],
    packOutRows: [
      { FdSvNum: 'food', SubEvtNum: 'S-MENU', ItemName: 'Spiced almonds', FSType: 'Food' },
      { FdSvNum: 'drink', SubEvtNum: 'S-MENU', ItemName: 'AGAVE SPICE', FSType: 'Liquor', Description: 'Tequila, lime and agave' },
      { FdSvNum: 'garnish', SubEvtNum: 'S-MENU', ItemName: 'GARNISH: Jalapeno', Comment: 'Half without', FSType: 'Food' },
    ],
    kitchenMenuRows: [
      { FdSvNum: 'food', SubEvtNum: 'S-MENU', ItemName: 'Spiced almonds', FSType: 'Food' },
      { FdSvNum: 'drink', SubEvtNum: 'S-MENU', ItemName: 'AGAVE SPICE', FSType: 'Liquor', Description: 'Tequila, lime and agave' },
      { FdSvNum: 'garnish', SubEvtNum: 'S-MENU', ItemName: 'GARNISH: Jalapeno', Comment: 'Half without', FSType: 'Food' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: {
      title: 'Cocktail',
      date: '2026-09-17',
      externalId: 'E22646',
      meta: { eventNotes: 'Keep the open kitchen clean.' },
    },
    snapshot,
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const beverageOffset = xml.indexOf('>BEVERAGE<');
  const cocktailOffset = xml.indexOf('>AGAVE SPICE<');
  assert.ok(beverageOffset > 0 && cocktailOffset > beverageOffset);
  assert.match(xml, />Tequila, lime and agave</);
  assert.match(xml, />Half without</);
  assert.doesNotMatch(xml, />GARNISH: Jalapeno</);
  assert.match(xml, /Last Modified: 9\/16\/2026 \(3:58 pm\)/);
  assert.match(xml, />EVENT NOTES</);
  assert.match(xml, />Keep the open kitchen clean\.</);
});

test('Kitchen Menu recovers beverage type from food service for an older saved snapshot', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Cocktail', date: '2026-09-17', externalId: 'E22646' },
    snapshot: {
      schemaVersion: 21,
      foodService: [{ sourceId: 'drink', foodServiceId: 'drink', itemName: 'AGAVE SPICE', fsType: 'Liquor' }],
      kitchenMenu: [{ sourceId: 'drink', itemName: 'AGAVE SPICE', menuGroup: 'PLACED' }],
    },
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.indexOf('>AGAVE SPICE<') > xml.indexOf('>BEVERAGE<'));
});

test('Kitchen Menu does not confuse Caterease staff call times with event timing', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: {
      title: 'Cocktail',
      date: '2026-09-14',
      externalId: 'E22856',
      meta: { eventTime: '6:30 PM – 8:00 PM' },
    },
    snapshot: {
      schemaVersion: 17,
      subEvents: [{ subEvent: 'S-MENU', startTime: '4:30 PM', endTime: '9:30 PM' }],
      kitchenPackOut: [],
      kitchenMenu: [{
        itemName: 'BONFIRE NIGHTS',
        subEvent: 'S-MENU',
        menuGroup: 'PASSED BEVERAGES',
        description: 'BONFIRE NIGHTS Mezcal, Tequila, Fresh Grapefruit',
        notes: 'NO MEZCAL',
      }],
      staffRequest: [{ position: 'Food Passer', required: 1, startTime: '4:30 PM', uniform: 'White shirt / Black tie' }],
    },
    recipes: [],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Event Timing: 6:30 PM – 8:00 PM/);
  assert.match(xml, /Staff Arrival on Site: 4:30 pm/);
  assert.doesNotMatch(xml, /Event Timing: 4:30 PM/);
  assert.match(xml, /White shirt \/ Black tie/);
  assert.match(xml, />Mezcal, Tequila, Fresh Grapefruit</);
  assert.match(xml, />NO MEZCAL</);
  assert.doesNotMatch(xml, />Revision</);
  assert.doesNotMatch(xml, />End:/);
});

test('operational documents prefer the event-facing time over the Caterease operational window', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: {
      title: 'Wedding',
      date: '2026-09-12',
      externalId: 'E20244',
      meta: { eventTime: '12:00 PM – 3:00 AM' },
    },
    snapshot: {
      schemaVersion: 19,
      client: 'Studio Sully Event Production & Design',
      eventStartTime: '16:00:00',
      eventEndTime: '02:00:00',
      kitchenPackOut: [{ itemName: 'Tray', station: 'Dinner' }],
      packOutTemplates: [],
    },
    type: 'kitchen_packout',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Client: Studio Sully Event Production &amp; Design/);
  assert.match(xml, /Event Date: 09\/12\/2026/);

  const menuBuffer = await renderCatereaseOperationalDocx({
    event: { title: 'Wedding', date: '2026-09-12', externalId: 'E20244', meta: { eventTime: '12:00 PM – 3:00 AM' } },
    snapshot: {
      schemaVersion: 19,
      client: 'Studio Sully Event Production & Design',
      eventStartTime: '16:00:00',
      eventEndTime: '02:00:00',
      kitchenMenu: [{ itemName: 'Dinner', menuGroup: 'MENU' }],
    },
    type: 'kitchen_menu',
  });
  const menuZip = await JSZip.loadAsync(menuBuffer);
  const menuXml = await menuZip.file('word/document.xml').async('string');
  assert.match(menuXml, /Event Timing: 12:00 PM – 3:00 AM/);
  assert.doesNotMatch(menuXml, /Event Timing: 4:00 pm – 2:00 am/);
});

test('Kitchen Menu prints a non-main zone name below its title', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672' },
    snapshot: {
      schemaVersion: 3,
      kitchenPackOut: [],
      kitchenMenu: [{ itemName: 'Family Meal', quantity: 12, category: 'Dinner' }],
    },
    type: 'kitchen_menu',
    zoneName: 'Staff Holding',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, />Staff Holding</);
  assert.match(xml, /<w:color w:val="FF0000"\/[^>]*>/);
});

test('operational DOCX does not print Main as a zone label', async () => {
  for (const zoneName of ['', 'Main']) {
    const buffer = await renderCatereaseOperationalDocx({
      event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
      snapshot: { schemaVersion: 3, packOut: [{ itemName: 'Water', quantity: 1, menuGroup: 'Beverage' }] },
      type: 'po',
      zoneName,
      includePackOutTemplate: false,
    });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    assert.doesNotMatch(xml, />Main</);
  }
});

test('generated operational DOCX is a valid Word package and escapes upstream text', async () => {
  const logoSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>');
  const decorPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: '<Bensadoun>', date: '2026-09-11', externalId: 'E22672' },
    snapshot: { schemaVersion: 2, packOut: [{ itemName: '<script>alert(1)</script>', quantity: 1, unit: 'Each', menuGroup: 'Kitchen Equipment', subEvent: '00001-00000000062666' }] },
    type: 'po',
    brandLogoSvg: logoSvg,
    decorImages: [{ itemName: '<script>alert(1)</script>', buffer: decorPhoto, extension: 'jpg' }],
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const embeddedLogo = await zip.file('word/media/logo.svg').async('nodebuffer');
  const embeddedPhoto = await zip.file('word/media/decor-1.jpg').async('nodebuffer');
  assert.deepEqual(embeddedLogo, logoSvg);
  assert.deepEqual(embeddedPhoto, decorPhoto);
  assert.doesNotMatch(xml, />PACK OUT</);
  assert.match(xml, /r:embed="rId2"/);
  assert.match(xml, /r:embed="rId3"/);
  assert.match(xml, /Photo/);
  assert.match(xml, /&lt;Bensadoun&gt;/);
  assert.doesNotMatch(xml, /<script>/);
  assert.match(xml, /KITCHEN EQUIPMENT/);
  assert.match(xml, /Notes\/Comments/);
  assert.doesNotMatch(xml, /00001-00000000062666/);
});

test('decor Pack Out uses the shared layout without unrelated blank template rows', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Decor Event', date: '2026-09-11', externalId: 'E22770' },
    snapshot: { schemaVersion: 3, packOut: [{ itemName: 'Gold Candelabra', quantity: 4, menuGroup: 'Decor', notes: 'OCC00440' }] },
    type: 'po',
    includePackOutTemplate: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.doesNotMatch(xml, />PACK OUT</);
  assert.match(xml, /Gold Candelabra/);
  assert.match(xml, /OCC00440/);
  assert.doesNotMatch(xml, /Paper plates/);
});

test('shared Pack Out template exposes item names used for photo matching', () => {
  const names = packOutRenderedItemNames([]);
  assert.ok(names.includes('Milano Stainless Steel Champagne Bucket'));
});

test('shared Pack Out template embeds a matched Milano product photo', async () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672' },
    snapshot: { schemaVersion: 3, packOut: [] },
    type: 'po',
    decorImages: [{ itemName: 'Milano Stainless Steel Champagne Bucket', buffer: photo, extension: 'jpg' }],
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Milano Stainless Steel Champagne Bucket/);
  assert.match(xml, /r:embed="rId3"/);
  assert.deepEqual(await zip.file('word/media/decor-1.jpg').async('nodebuffer'), photo);
});
