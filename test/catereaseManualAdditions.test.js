import test from 'node:test';
import assert from 'node:assert/strict';

import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import {
  loadAuthorizedOperationalEvent,
  syncOperationalEvent,
} from '../routes/catereaseIntegration.js';

test('a full Caterease operational sync leaves manual additions untouched', async () => {
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
  await syncOperationalEvent(event, {
    fetchSnapshot: async () => snapshot,
    primaryFiles: false,
  });
  assert.deepEqual(event.catereaseManualAdditions, additions);
  assert.equal(event.catereaseOperations, snapshot);
  assert.deepEqual(event.markModifiedCalls, ['catereaseOperations']);
  assert.equal(event.saved, true);
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
