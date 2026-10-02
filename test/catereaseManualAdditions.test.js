import test from 'node:test';
import assert from 'node:assert/strict';

import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import {
  loadAuthorizedOperationalEvent,
  normalizedEventSeriesTitle,
  recordCatereaseOperationalSyncError,
  selectCatereaseOperationalEvent,
  syncOperationalEvent,
} from '../routes/catereaseIntegration.js';

test('Caterease matching recognizes a moved event whose series day label changed', () => {
  const rows = [
    { EvtNum: '00001-00000000022894', EventNum: 'E22894', PartyName: 'Gucci Wooster Private Appointments- Day One' },
    { EvtNum: '00001-00000000022900', EventNum: 'E22900', PartyName: 'Unrelated Event' },
  ];
  assert.equal(
    selectCatereaseOperationalEvent({
      rows,
      eventId: 'E22895 - S62805',
      eventTitle: 'Gucci Wooster Private Appointments- Day Two',
    })?.EvtNum,
    '00001-00000000022894',
  );
  assert.equal(
    normalizedEventSeriesTitle('Gucci Wooster Private Appointments — Day 2'),
    'gucci wooster private appointments',
  );
});

test('Caterease series matching refuses ambiguous same-date candidates', () => {
  const rows = [
    { EvtNum: 'first', PartyName: 'Gucci Wooster Private Appointments- Day One' },
    { EvtNum: 'second', PartyName: 'Gucci Wooster Private Appointments- Day Two' },
  ];
  assert.equal(selectCatereaseOperationalEvent({
    rows,
    eventId: 'E99999',
    eventTitle: 'Gucci Wooster Private Appointments- Day 3',
  }), null);
});

test('a full Caterease operational sync leaves manual additions untouched', async (t) => {
  const source = process.env.EVENT_DOCUMENT_SOURCE;
  process.env.EVENT_DOCUMENT_SOURCE = 'caterease';
  t.after(() => { if (source === undefined) delete process.env.EVENT_DOCUMENT_SOURCE; else process.env.EVENT_DOCUMENT_SOURCE = source; });
  const additions = [{
    _id: '66f000000000000000000001',
    documentType: 'po',
    templateKey: 'pack-template',
    zoneKey: 'dinner',
    itemName: 'Macarons',
    quantity: 24,
    addedBy: 'manager-one',
  }];
  const event = {
    externalId: 'E22856',
    date: '2026-09-14',
    title: 'Chanel YPO Cocktail',
    catereaseOperations: { checksum: 'old' },
    catereaseManualAdditions: structuredClone(additions),
    markModifiedCalls: [],
    markModified(field) { this.markModifiedCalls.push(field); },
    async save() { this.saved = true; },
  };
  const snapshot = {
    checksum: 'new',
    packOut: [],
    kitchenPackOut: [],
    kitchenMenu: [],
    staffRequest: [],
  };
  const previousSnapshot = event.catereaseOperations;
  let alertInput = null;
  await syncOperationalEvent(event, {
    fetchSnapshot: async () => snapshot,
    processAlerts: async (input) => { alertInput = input; return []; },
    primaryFiles: false,
  });
  assert.deepEqual(event.catereaseManualAdditions, additions);
  assert.equal(event.catereaseOperations, snapshot);
  assert.deepEqual(event.markModifiedCalls, ['catereaseOperations']);
  assert.equal(event.saved, true);
  assert.equal(alertInput.previousSnapshot, previousSnapshot);
  assert.equal(alertInput.snapshot, snapshot);
});

test('Caterease preview sync cannot send a second PO alert when Dropbox owns the schedule', async (t) => {
  const source = process.env.EVENT_DOCUMENT_SOURCE;
  process.env.EVENT_DOCUMENT_SOURCE = 'dropbox';
  t.after(() => { if (source === undefined) delete process.env.EVENT_DOCUMENT_SOURCE; else process.env.EVENT_DOCUMENT_SOURCE = source; });
  const result = await syncOperationalEvent({ externalId: 'E12345', title: 'Dinner', date: '2026-10-04', markModified() {}, async save() {} }, {
    primaryFiles: false,
    fetchSnapshot: async () => ({ checksum: 'new', packOut: [], kitchenPackOut: [], kitchenMenu: [], staffRequest: [] }),
    processAlerts: async () => { assert.fail('Dropbox schedules must not trigger legacy Caterease mail'); },
  });
  assert.deepEqual(result.automationAlerts, []);
});

test('operational sync promotes the Caterease client before syncing Bar Operations', async () => {
  const event = {
    externalId: 'E22851 - S62638',
    date: '2026-09-24',
    title: 'Prada Uomo Appts- Day 1',
    client: '',
    catereaseOperations: null,
    markModified() {},
    async save() { this.savedClient = this.client; },
  };
  let barClient = '';
  await syncOperationalEvent(event, {
    fetchSnapshot: async () => ({
      checksum: 'client-sync',
      client: 'PRADA USA Corp.',
      packOut: [],
      kitchenPackOut: [],
      kitchenMenu: [],
      staffRequest: [],
    }),
    processAlerts: async () => [],
    syncBarItems: async (nextEvent) => {
      barClient = nextEvent.client;
      return { synced: true, items: 0 };
    },
    primaryFiles: true,
  });
  assert.equal(event.savedClient, 'PRADA USA Corp.');
  assert.equal(barClient, 'PRADA USA Corp.');
});

test('operational primary mode sends the refreshed snapshot to Bar Operations', async () => {
  const previousSource = process.env.EVENT_DOCUMENT_SOURCE;
  const previousOperational = process.env.CATEREASE_OPERATIONAL_SYNC_ENABLED;
  const previousApiKey = process.env.CATEREASE_API_KEY;
  process.env.EVENT_DOCUMENT_SOURCE = 'caterease';
  process.env.CATEREASE_OPERATIONAL_SYNC_ENABLED = 'true';
  process.env.CATEREASE_API_KEY = 'test-key';
  const snapshot = {
    checksum: 'bar-guests',
    guestCount: 180,
    packOut: [],
    kitchenPackOut: [],
    kitchenMenu: [],
    staffRequest: [],
  };
  let syncedSnapshot = null;
  const event = {
    externalId: 'E22856',
    date: '2026-09-14',
    title: 'Chanel YPO Cocktail',
    catereaseOperations: null,
    markModified() {},
    async save() {},
  };
  try {
    await syncOperationalEvent(event, {
      fetchSnapshot: async () => snapshot,
      processAlerts: async () => [],
      syncBarItems: async (_event, nextSnapshot) => {
        syncedSnapshot = nextSnapshot;
        return { synced: true, items: 0 };
      },
    });
  } finally {
    if (previousSource === undefined) delete process.env.EVENT_DOCUMENT_SOURCE;
    else process.env.EVENT_DOCUMENT_SOURCE = previousSource;
    if (previousOperational === undefined) delete process.env.CATEREASE_OPERATIONAL_SYNC_ENABLED;
    else process.env.CATEREASE_OPERATIONAL_SYNC_ENABLED = previousOperational;
    if (previousApiKey === undefined) delete process.env.CATEREASE_API_KEY;
    else process.env.CATEREASE_API_KEY = previousApiKey;
  }
  assert.equal(syncedSnapshot, snapshot);
});

test('a partial Caterease response preserves the last complete snapshot and skips downstream writes', async () => {
  const previousSnapshot = {
    checksum: 'complete-snapshot',
    packOut: [{ itemName: 'Heat Lamp', quantity: 2 }],
    kitchenPackOut: [{ itemName: 'Sheet Pan', quantity: 4 }],
    kitchenMenu: [],
    staffRequest: [],
  };
  const partialSnapshot = {
    checksum: 'partial-snapshot',
    packOut: [],
    kitchenPackOut: [{ itemName: 'Sheet Pan', quantity: 4 }],
    kitchenMenu: [],
    staffRequest: [],
    sourceErrors: [{ source: 'foodserv', status: 503, message: 'Caterease unavailable' }],
  };
  const calls = { saved: 0, alerts: 0, bar: 0 };
  const event = {
    externalId: 'E22856',
    date: '2026-09-14',
    title: 'Chanel YPO Cocktail',
    catereaseOperations: previousSnapshot,
    markModified() { throw new Error('partial snapshot must not mark the event modified'); },
    async save() { calls.saved += 1; },
  };

  await assert.rejects(
    syncOperationalEvent(event, {
      fetchSnapshot: async () => partialSnapshot,
      processAlerts: async () => { calls.alerts += 1; return []; },
      syncBarItems: async () => { calls.bar += 1; return { synced: true, items: 0 }; },
      primaryFiles: true,
    }),
    (error) => error?.code === 'CATEREASE_PARTIAL_OPERATIONAL_SNAPSHOT' && error?.statusCode === 502,
  );

  assert.equal(event.catereaseOperations, previousSnapshot);
  assert.deepEqual(calls, { saved: 0, alerts: 0, bar: 0 });
});

test('operational sync records every failed event instead of hiding failures after twelve', () => {
  const summary = { failed: 0, errors: [] };
  for (let index = 1; index <= 14; index += 1) {
    recordCatereaseOperationalSyncError(summary, {
      externalId: `E${String(index).padStart(5, '0')}`,
      title: `Event ${index}`,
    }, Object.assign(new Error(`Source ${index} failed`), { statusCode: 502 }));
  }

  assert.equal(summary.failed, 14);
  assert.equal(summary.errors.length, 14);
  assert.deepEqual(summary.errors[13], {
    eventId: 'E00014',
    title: 'Event 14',
    status: 502,
    message: 'Source 14 failed',
  });
});

test('editing and deleting a manual addition targets only the matching subdocument id', () => {
  const event = new Event({
    title: 'Manual additions',
    catereaseManualAdditions: [
      { documentType: 'po', itemName: 'Fruit Skewers', quantity: 8 },
      { documentType: 'po', itemName: 'Macarons', quantity: 12 },
    ],
  });
  const firstId = event.catereaseManualAdditions[0]._id;
  const secondId = event.catereaseManualAdditions[1]._id;
  Object.assign(event.catereaseManualAdditions.id(firstId), { quantity: 16, notes: 'Revised' });
  assert.equal(event.catereaseManualAdditions.id(firstId).quantity, 16);
  assert.equal(event.catereaseManualAdditions.id(secondId).quantity, 12);
  assert.equal(event.catereaseManualAdditions.id(secondId).notes, '');
  event.catereaseManualAdditions.pull(firstId);
  assert.equal(event.catereaseManualAdditions.id(firstId), null);
  assert.equal(event.catereaseManualAdditions.id(secondId).itemName, 'Macarons');
});

test('manual additions accept every generated operational document type', () => {
  const event = new Event({
    title: 'All document types',
    catereaseManualAdditions: [
      { documentType: 'po', itemName: 'PO row' },
      { documentType: 'kitchen_packout', itemName: 'KPO row' },
      { documentType: 'staff_request', itemName: 'Staff row' },
      { documentType: 'kitchen_menu', itemName: 'KM row' },
      { documentType: 'annotated_kitchen_menu', itemName: 'AKM row' },
    ],
  });

  assert.equal(event.validateSync(), undefined);
  assert.equal(event.catereaseManualAdditions.length, 5);
});

test('an unassigned bar captain receives the operational-event 403 guard', async (context) => {
  const eventQuery = {
    select() { return this; },
    async lean() { return { _id: '66f000000000000000000010', title: 'Restricted event' }; },
  };
  const barQuery = {
    select() { return this; },
    async lean() { return { assignedUserIds: ['another-captain'] }; },
  };
  context.mock.method(Event, 'findById', () => eventQuery);
  context.mock.method(BarEvent, 'findOne', () => barQuery);
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const result = await loadAuthorizedOperationalEvent({
    params: { id: '66f000000000000000000010' },
    auth: { userId: 'captain-one', role: 'bar captain' },
  }, response);
  assert.equal(result, null);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'This event is not assigned to your account' });
});

test('a packer cannot open Caterease operational event tools', async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const result = await loadAuthorizedOperationalEvent({
    params: { id: '66f000000000000000000010' },
    auth: { userId: 'packer-one', role: 'packer' },
  }, response);
  assert.equal(result, null);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'Operational event access is not available for packers' });
});
