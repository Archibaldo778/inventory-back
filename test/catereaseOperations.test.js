import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  buildCatereaseOperationalSnapshot,
  normalizeCatereaseKitchenMenuRows,
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

test('Caterease Kitchen Production rows preserve required item details', () => {
  const rows = normalizeCatereaseKitchenMenuRows([{
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

test('operational snapshot checksum is stable when API row order changes', () => {
  const first = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'B', Qty: 2 }, { ItemName: 'A', Qty: 1 }],
    syncedAt: new Date('2026-09-11T12:00:00Z'),
  });
  assert.equal(first.schemaVersion, 2);
  const second = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'A', Qty: 1 }, { ItemName: 'B', Qty: 2 }],
    syncedAt: new Date('2026-09-11T13:00:00Z'),
  });
  assert.equal(first.checksum, second.checksum);
});

test('generated operational DOCX is a valid Word package and escapes upstream text', async () => {
  const buffer = await renderCatereaseOperationalDocx({
    event: { title: '<Bensadoun>', date: '2026-09-11', externalId: 'E22672' },
    snapshot: { schemaVersion: 2, packOut: [{ itemName: '<script>alert(1)</script>', quantity: 1, unit: 'Each', menuGroup: 'Kitchen Equipment', subEvent: '00001-00000000062666' }] },
    type: 'po',
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /&lt;Bensadoun&gt;/);
  assert.doesNotMatch(xml, /<script>/);
  assert.match(xml, /KITCHEN EQUIPMENT/);
  assert.match(xml, /Notes\/Comments/);
  assert.doesNotMatch(xml, /00001-00000000062666/);
});
