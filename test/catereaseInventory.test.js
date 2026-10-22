import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryClient, inventoryDestination, inventoryPayload, existingInventoryItem, deliverInventoryJob } from '../utils/catereaseInventoryApi.js';

const destination = { locNum: '00001', menuNum: 'occ-menu', itemType: 4 };
const product = { name: '11 oz Silver Traditional', inventoryCode: 'OCC00764', quantity: 200, description: 'Silver', category: 'Glassware' };
const payload = inventoryPayload(product, destination);
const job = { payload, status: 'pending', idempotencyKey: 'stable-key' };
const remote = { LocNum: '00001', MenuNum: 'occ-menu', ItemID: 'OCC00764', ItemName: product.name, ItemNum: 'remote-1' };

test('inventory export preserves the exact name and OCC code without inventing prices or exporting stock as servings', () => {
  assert.deepEqual(payload, { ...destination, itemName: product.name, itemID: 'OCC00764', description: 'Silver', category: 'Glassware', inactive: false });
  assert.throws(() => inventoryPayload({ name: 'No code' }, destination), /OCC inventory code/);
});
test('destination is the unique active OCC Inventory catalog at our location and Equipment type', () => {
  const menus = [{ Title: 'Equipment', MenuNum: 'existing', LocNum: '00001' }, { Title: 'OCC Inventory', MenuNum: 'occ-menu', LocNum: '00001' }];
  const types = [{ Caption: 'Equipment', Active: true, LocNum: '00001', ID: 4 }];
  assert.deepEqual(inventoryDestination(menus, types), destination);
  assert.throws(() => inventoryDestination(menus.slice(0, 1), types), /Create an active/);
  assert.throws(() => inventoryDestination([...menus, menus[1]], types), /Multiple/);
});
test('same code in a different catalog does not get changed; duplicate or renamed destination items require review', () => {
  assert.equal(existingInventoryItem([{ ...remote, MenuNum: 'other' }], payload), null);
  assert.throws(() => existingInventoryItem([remote, remote], payload), /Duplicate/);
  assert.throws(() => existingInventoryItem([{ ...remote, ItemName: 'Changed name' }], payload), /needs review/);
});
test('repeated sync and recovery after lost response link the existing item without creating a duplicate', async () => {
  const client = { create() { throw Error('must not write'); } };
  assert.deepEqual(await deliverInventoryJob(job, [remote], client), { status: 'sent', itemNum: 'remote-1' });
  assert.deepEqual(await deliverInventoryJob({ ...job, status: 'sending' }, [remote], client), { status: 'sent', itemNum: 'remote-1' });
  assert.equal((await deliverInventoryJob({ ...job, status: 'review' }, [], client)).status, 'review');
});
test('new item creates once with its saved payload and idempotency key', async () => {
  let calls = 0;
  const result = await deliverInventoryJob(job, [], { async create(body, key) { calls++; assert.deepEqual(body, payload); assert.equal(key, 'stable-key'); return { itemNum: 'created' }; } });
  assert.equal(calls, 1); assert.deepEqual(result, { status: 'sent', itemNum: 'created' });
});
test('403 is an explicit failure while timeout and 502 are quarantined without automatic recreation', async () => {
  for (const statusCode of [403, 502, undefined]) {
    const result = await deliverInventoryJob(job, [], { async create() { throw Object.assign(new Error('Request failed'), { statusCode }); } });
    assert.equal(result.status, statusCode === 403 ? 'failed' : 'review');
  }
});
test('client uses only the dedicated key and reads every catalog page', async () => {
  const requests = [];
  const client = createInventoryClient({ key: 'dedicated-test-key', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(requests.length === 1 ? { data: [{ Title: 'Other' }], pagination: { hasMore: true, nextCursor: 'page2' } } : { data: [{ Title: 'OCC Inventory' }], pagination: { hasMore: false } }));
  } });
  assert.equal((await client.list('menu')).length, 2);
  assert.equal(requests[0].options.headers['X-API-Key'], 'dedicated-test-key');
  assert.ok(requests[1].url.includes('cursor=page2'));
});
test('incomplete pagination fails instead of treating an incomplete catalog as safe for writes', async () => {
  const client = createInventoryClient({ key: 'test', fetchImpl: async () => new Response(JSON.stringify({ data: [], pagination: { hasMore: true } })) });
  await assert.rejects(() => client.list('menu'), /Incomplete/);
});

import Product from '../models/Product.js';
import { InventorySyncSettings, InventorySyncJob } from '../models/CatereaseInventorySync.js';
import { runInventorySync } from '../utils/catereaseInventorySync.js';
import { requestAccessKeys } from '../utils/accessRolePolicy.js';

test('enabling inventory export requires integration edit and sync permissions', () => {
  assert.deepEqual(requestAccessKeys({ originalUrl: '/api/integrations/caterease-inventory/sync/enable', method: 'POST', auth: {} }), ['integrations.view', 'integrations.edit', 'integrations.sync']);
});

test('worker automatically discovers a new product, saves delivery before the next run, and does not resend', async () => {
  const saved = { pf: Product.find, pi: Product.findById, sf: InventorySyncSettings.findOneAndUpdate, su: InventorySyncSettings.updateOne, jf: InventorySyncJob.find, ju: InventorySyncJob.updateOne, key: process.env.CATEREASE_INVENTORY_API_KEY };
  let stored = null, writes = 0, reads = 0;
  const query = value => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, async lean() { return value; } });
  process.env.CATEREASE_INVENTORY_API_KEY = 'test';
  Product.find = () => query([{ ...product, _id: 'p1' }]);
  Product.findById = () => query({ _id: 'p1' });
  InventorySyncSettings.findOneAndUpdate = () => query({ destination });
  InventorySyncSettings.updateOne = async () => ({ matchedCount: 1 });
  InventorySyncJob.find = filter => query(!stored ? [] : !filter.status || stored.status === filter.status || filter.status?.$in?.includes(stored.status) ? [{ ...stored }] : []);
  InventorySyncJob.updateOne = async (filter, update) => {
    if (filter.status && stored?.status !== filter.status) return { modifiedCount: 0 };
    if (!stored && update.$setOnInsert) stored = { _id: 'p1', ...update.$setOnInsert };
    if (update.$set) Object.assign(stored, update.$set);
    return { modifiedCount: 1 };
  };
  const client = {
    async list(resource) { reads++; return resource === 'menu' ? [{ Title: 'OCC Inventory', LocNum: '00001', MenuNum: 'occ-menu' }] : resource === 'foodservtype' ? [{ Caption: 'Equipment', LocNum: '00001', ID: 4, Active: true }] : []; },
    async create() { writes++; assert.equal(stored.status, 'sending'); return { itemNum: 'created' }; },
  };
  try {
    await runInventorySync({ client });
    assert.equal(stored.status, 'sent'); assert.equal(stored.itemNum, 'created');
    await runInventorySync({ client });
    assert.equal(writes, 1); assert.equal(reads, 3);
    stored.status = 'sending';
    await runInventorySync({ client });
    assert.equal(stored.status, 'review'); assert.equal(writes, 1);
  } finally {
    Product.find = saved.pf; Product.findById = saved.pi;
    InventorySyncSettings.findOneAndUpdate = saved.sf; InventorySyncSettings.updateOne = saved.su;
    InventorySyncJob.find = saved.jf; InventorySyncJob.updateOne = saved.ju;
    if (saved.key === undefined) delete process.env.CATEREASE_INVENTORY_API_KEY; else process.env.CATEREASE_INVENTORY_API_KEY = saved.key;
  }
});

import { retryRejectedInventoryJobs } from '../utils/catereaseInventorySync.js';
test('manual retry only requeues explicitly rejected jobs using a fresh key and current product', async () => {
  const saved = { pf: Product.find, sf: InventorySyncSettings.findById, jf: InventorySyncJob.find, ju: InventorySyncJob.updateOne };
  let updated;
  const query = value => ({ select() { return this; }, sort() { return this; }, async lean() { return value; } });
  Product.find = () => query([{ ...product, _id: 'p1' }]);
  InventorySyncSettings.findById = () => query({ destination });
  InventorySyncJob.find = filter => { assert.deepEqual(filter, { status: 'failed' }); return query([{ _id: 'p1' }]); };
  InventorySyncJob.updateOne = async (filter, update) => { assert.deepEqual(filter, { _id: 'p1', status: 'failed' }); updated = update.$set; return { modifiedCount: 1 }; };
  try {
    assert.deepEqual(await retryRejectedInventoryJobs(), { queued: 1 });
    assert.equal(updated.status, 'pending'); assert.deepEqual(updated.payload, payload); assert.ok(updated.idempotencyKey);
  } finally { Product.find = saved.pf; InventorySyncSettings.findById = saved.sf; InventorySyncJob.find = saved.jf; InventorySyncJob.updateOne = saved.ju; }
});
