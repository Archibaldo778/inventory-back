import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryStockPayload, syncInventoryStock } from '../utils/catereaseInventoryStock.js';
import { createInventoryClient } from '../utils/catereaseInventoryApi.js';
const product = { inventoryCode: 'OCC00001', quantity: 47 };
const job = { itemNum: 'item', payload: { locNum: '00001', menuNum: 'menu' } };
const remote = { ItemNum: 'item', ItemID: 'OCC00001', LocNum: '00001', MenuNum: 'menu', InvItem: false, InvInstock: 5 };
test('total stock includes zero and rejects unknown quantities instead of inventing zero', () => {
  assert.deepEqual(inventoryStockPayload(product), { invItem: true, invInstock: 47 });
  assert.deepEqual(inventoryStockPayload({ quantity: 0 }), { invItem: true, invInstock: 0 });
  for (const quantity of [undefined, null, '', false, -1, Infinity, 1000000]) assert.throws(() => inventoryStockPayload({ quantity }));
});
test('stock PATCH changes only inventory fields and verifies read-back; retry does not rewrite', async () => {
  let current = { ...remote }, writes = 0;
  const client = {
    async readStock() { return current; },
    async patchStock(id, loc, body) {
      assert.equal(id, 'item'); assert.equal(loc, '00001');
      assert.deepEqual(body, { invItem: true, invInstock: 47 });
      writes++; current = { ...current, InvItem: body.invItem, InvInstock: body.invInstock };
    },
  };
  assert.equal(await syncInventoryStock(product, job, client), 47);
  assert.equal(await syncInventoryStock(product, job, client), 47);
  assert.equal(writes, 1);
  assert.equal(await syncInventoryStock({ ...product, quantity: 47 }, job, client), 47);
});
test('wrong identity and unconfirmed writes never count as synchronized', async () => {
  await assert.rejects(syncInventoryStock(product, job, { readStock: async () => ({ ...remote, ItemID: 'OTHER' }), patchStock: () => assert.fail('must not write') }), /identity/);
  await assert.rejects(syncInventoryStock(product, job, { readStock: async () => remote, patchStock: async () => {} }), /read-back/);
  await assert.rejects(syncInventoryStock(product, job, { readStock: async () => remote, patchStock: async () => { throw Error('412'); } }), /412/);
});
test('stock client uses a fresh ETag and sends only the requested stock fields', async () => {
  const calls = [];
  const client = createInventoryClient({ key: 'test', fetchImpl: async (url, opts) => {
    calls.push({ url, ...opts });
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { ETag: '"version1"', 'Content-Type': 'application/json' } });
  } });
  await client.patchStock('item', '00001', inventoryStockPayload(product));
  assert.ok(calls[0].url.endsWith('/item/version?locNum=00001'));
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].headers['If-Match'], '"version1"');
  assert.deepEqual(JSON.parse(calls[1].body), { invItem: true, invInstock: 47 });
});
