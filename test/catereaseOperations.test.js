import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  buildCatereaseOperationalSnapshot,
  buildKitchenMenuRows,
  normalizeCatereaseKitchenMenuDishRows,
  normalizeCatereaseKitchenPackOutRows,
  normalizeCatereasePackOutRows,
  renderCatereaseOperationalDocx,
} from '../utils/catereaseOperations.js';

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
    category: 'Dessert',
    description: '',
    notes: 'Plate cold.',
  });
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

test('operational snapshot checksum is stable when API row order changes', () => {
  const first = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'B', Qty: 2 }, { ItemName: 'A', Qty: 1 }],
    syncedAt: new Date('2026-09-11T12:00:00Z'),
  });
  assert.equal(first.schemaVersion, 3);
  const second = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'A', Qty: 1 }, { ItemName: 'B', Qty: 2 }],
    syncedAt: new Date('2026-09-11T13:00:00Z'),
  });
  assert.equal(first.checksum, second.checksum);
});

test('Kitchen Menu DOCX uses dish names and matched Caterease instructions', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Dinner', date: '2026-09-11', externalId: 'E22672' },
    snapshot: { schemaVersion: 3, kitchenMenu: [{ itemName: 'Caramel Apple', prepArea: 'Pastry', componentCount: 2 }] },
    recipes: [{ name: 'Caramel Apple', instructions: 'Temper apples before service.', ingredients: [] }],
    type: 'kitchen_menu',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /KITCHEN MENU/);
  assert.match(xml, /Caramel Apple/);
  assert.match(xml, /Temper apples before service/);
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
  assert.match(xml, /PACK OUT/);
  assert.match(xml, /r:embed="rId2"/);
  assert.match(xml, /r:embed="rId3"/);
  assert.match(xml, /Photo/);
  assert.match(xml, /&lt;Bensadoun&gt;/);
  assert.doesNotMatch(xml, /<script>/);
  assert.match(xml, /KITCHEN EQUIPMENT/);
  assert.match(xml, /Notes\/Comments/);
  assert.doesNotMatch(xml, /00001-00000000062666/);
});
