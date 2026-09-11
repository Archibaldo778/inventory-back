import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCatereaseOperationalSnapshot,
  normalizeCatereaseKitchenMenuRows,
  normalizeCatereasePackOutRows,
  renderCatereaseOperationalHtml,
} from '../utils/catereaseOperations.js';

test('Caterease Pack Out rows preserve quantities, purchase units and station grouping', () => {
  const rows = normalizeCatereasePackOutRows([{
    UID: 42,
    ItemName: '8 Quart Chafing Dish',
    Qty: 4,
    Unit: 'Each',
    PUnit: 'Case',
    QtyPerPUnit: 2,
    FSPrepArea: 'Hot Line',
    FSName: 'Supreme Buffet',
    RentalItem: false,
  }]);

  assert.deepEqual(rows[0], {
    sourceId: '42',
    itemName: '8 Quart Chafing Dish',
    quantity: 4,
    unit: 'Each',
    purchaseUnit: 'Case',
    quantityPerPurchaseUnit: 2,
    prepArea: 'Hot Line',
    station: 'Supreme Buffet',
    rentalItem: false,
    vendor: '',
    serviceDate: '',
    startTime: '',
  });
});

test('Caterease Kitchen Menu rows retain sub-event zones', () => {
  const rows = normalizeCatereaseKitchenMenuRows([{
    ItemNum: 'MI-1',
    ItemName: 'Caramel Apple',
    Qty: 120,
    PrepArea: 'Pastry',
    SubEvtNum: 'Rooftop',
    Category: 'Dessert',
    MenuGroup: 'Passed',
  }]);
  assert.equal(rows[0].itemName, 'Caramel Apple');
  assert.equal(rows[0].subEvent, 'Rooftop');
  assert.equal(rows[0].prepArea, 'Pastry');
});

test('operational snapshot checksum is stable when API row order changes', () => {
  const first = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'B', Qty: 2 }, { ItemName: 'A', Qty: 1 }],
    syncedAt: new Date('2026-09-11T12:00:00Z'),
  });
  const second = buildCatereaseOperationalSnapshot({
    eventId: 'E22672',
    packOutRows: [{ ItemName: 'A', Qty: 1 }, { ItemName: 'B', Qty: 2 }],
    syncedAt: new Date('2026-09-11T13:00:00Z'),
  });
  assert.equal(first.checksum, second.checksum);
});

test('generated operational HTML escapes upstream text', () => {
  const html = renderCatereaseOperationalHtml({
    event: { title: '<Bensadoun>', date: '2026-09-11', externalId: 'E22672' },
    snapshot: { packOut: [{ itemName: '<script>alert(1)</script>', quantity: 1, unit: 'Each', prepArea: 'Hot Line' }] },
    type: 'po',
  });
  assert.match(html, /&lt;Bensadoun&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Hot Line/);
});
