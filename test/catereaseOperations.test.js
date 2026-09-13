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
  packOutRenderedItemNames,
  renderCatereaseOperationalDocx,
} from '../utils/catereaseOperations.js';
import {
  CATEREASE_OPERATIONAL_BAR_ITEMS_VERSION,
  catereaseOperationalPackOutToBarItems,
  hasAppliedCatereaseOperationalChecksum,
} from '../utils/catereaseOperationalBarItems.js';
import { runImportedBarItemMergePipeline } from '../utils/barManualItems.js';
import {
  buildCatereasePackOutTemplateSummaries,
  catereasePackOutTemplateRows,
} from '../utils/catereasePackOutTemplates.js';

test('Caterease Pack Out templates reproduce the five location grouping rules', () => {
  const rows = normalizeCatereaseKitchenPackOutRows([
    { UID: '1', ItemName: 'Chafing Dish', Qty: 2, FSType: 'Equipment', Category: 'Hot', FSName: 'Buffet', FSPrepArea: 'Hot Line' },
    { UID: '2', ItemName: 'Bread', Qty: 12, FSType: 'Food', Category: 'Bakery', FSName: 'Bread Service', FSPrepArea: 'Pantry' },
  ]);
  const summaries = buildCatereasePackOutTemplateSummaries(rows);
  assert.deepEqual(summaries.map(({ key, rowCount }) => [key, rowCount]), [
    ['kitchen_pack_out', 2],
    ['pack_out', 1],
    ['kitchen_pack_out_testing', 2],
    ['test_kitchen_pack_out', 2],
    ['required_items', 2],
  ]);
  assert.deepEqual(catereasePackOutTemplateRows(rows, 'pack_out').map((row) => row.itemName), ['Chafing Dish']);
  assert.equal(rows[0].fsType, 'Equipment');
  assert.equal(rows[0].category, 'Hot');
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
  }]);

  assert.deepEqual(rows[0], {
    sourceId: '42',
    itemId: 'MI-1',
    itemName: 'C-folds',
    quantity: 4,
    unit: 'Each',
    prepArea: 'Operations',
    subEvent: '00001-S1',
    zoneName: '',
    category: 'Paper goods',
    menuGroup: 'Kitchen Equipment',
    notes: '',
  });
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
    packOutRows: [
      { ItemName: 'Green Room Ice', Qty: 2, SubEvtNum: 'S1', SEDescription: 'Green Room' },
      { ItemName: 'Staff Holding Water', Qty: 4, SubEvtNum: 'S2', SEDescription: 'Staff Holding' },
    ],
  });
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672', meta: {} },
    snapshot,
    type: 'po',
    zoneKey: 's1|green room',
    zoneName: 'Green Room',
    includePackOutTemplate: false,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Green Room Ice/);
  assert.doesNotMatch(xml, /Staff Holding Water/);
  assert.match(xml, />PACK OUT</);
  assert.match(xml, />Green Room</);
  assert.match(xml, /<w:color w:val="FF0000"\/[^>]*>/);
  assert.match(xml, /<w:sz w:val="36"\/[^>]*>/);
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="32"\/><w:szCs w:val="32"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Dinner<\/w:t>/);
  assert.doesNotMatch(xml, /<w:color w:val="FF0000"\/>.*?<w:t xml:space="preserve">PACK OUT<\/w:t>/s);
  assert.doesNotMatch(xml, />Photo</);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 2, 'Caterease PO uses one event table and one continuous item table');
  assert.match(xml, /<w:gridSpan w:val="5"\/[^>]*>/);
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

test('Kitchen Pack Out uses the Caterease PO table layout', async () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
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
  assert.match(xml, />KITCHEN PACK OUT</);
  assert.match(xml, />Name</);
  assert.match(xml, />Qty</);
  assert.match(xml, />Notes\/Comments</);
  assert.match(xml, />Delivered</);
  assert.match(xml, />Returned</);
  assert.match(xml, />HOT LINE</);
  assert.match(xml, />Each · Kitchen</);
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
  assert.match(xml, />PACK OUT</);
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
  assert.match(xml, /STAFF REQUEST/);
  assert.match(xml, /Captain/);
  assert.match(xml, /16:00/);
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
    menuGroup: '',
    description: '',
    notes: 'Plate cold.',
  });
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

test('Kitchen Menu prefers dishes derived from Kitchen Pack Out over generic food service rows', () => {
  const snapshot = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    kitchenPackOutRows: [
      { ItemName: 'Mousse', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
      { ItemName: 'Apple center', Qty: 12, FSName: 'Caramel Apple', FSPrepArea: 'Pastry' },
    ],
    kitchenMenuRows: [{ ItemName: 'Passed Sweets, select 2', Description: String.raw`{\rtf1\ansi Generic group}` }],
  });
  assert.deepEqual(snapshot.kitchenMenu.map((row) => row.itemName), ['Caramel Apple']);
  assert.equal(snapshot.kitchenMenu[0].componentCount, 2);
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
  assert.equal(first.schemaVersion, 6);
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
  assert.match(xml, /<w:b\/><w:color w:val="FF0000"\/><w:sz w:val="32"\/><w:szCs w:val="32"\/[^>]*><\/w:rPr><w:t xml:space="preserve">Dinner<\/w:t>/);
  assert.match(xml, />Qty</);
  assert.match(xml, />Item</);
  assert.match(xml, />Comment</);
  assert.match(xml, /Label \(OCC; Rentals\)/);
  assert.match(xml, />Plate cold\.</);
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
  assert.match(xml, />PACK OUT</);
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
  assert.match(xml, />PACK OUT</);
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
