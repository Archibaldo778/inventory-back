import { inventoryStockPayload, syncInventoryStock } from './catereaseInventoryStock.js';
import { randomUUID } from 'node:crypto';
import Product from '../models/Product.js';
import { InventorySyncSettings, InventorySyncJob } from '../models/CatereaseInventorySync.js';
import { createInventoryClient, inventoryDestination, inventoryCategoryDestination, inventoryPayload, deliverInventoryJob, isExportableInventoryProduct } from './catereaseInventoryApi.js';

const products = async () => (await Product.find({}).select('name inventoryCode description category image imageUrl images quantity').sort({ _id: 1 }).lean()).filter(isExportableInventoryProduct);
export async function previewInventorySync() {
  const client = createInventoryClient();
  const [menus, types, items, settings, jobs] = await Promise.all([
    client.list('menu'), client.list('foodservtype'), products(),
    InventorySyncSettings.findById('inventory').lean(), InventorySyncJob.find({}).select('status itemNum error stockError stockQuantity payload.itemID payload.itemName').lean(),
  ]);
  let destination = null, error = '';
  try { destination = inventoryDestination(menus, types); } catch (e) { error = e.message; }
  return {
    enabled: Boolean(settings?.enabled), destination, error, lastError: settings?.lastError || '', lastRunAt: settings?.lastRunAt,
    products: items.map(p => {
      try { if (destination) inventoryPayload(p, inventoryCategoryDestination(p, destination, menus)); else inventoryPayload(p, {}); return { id: String(p._id), name: p.name, code: p.inventoryCode }; }
      catch (e) { return { id: String(p._id), name: p.name, code: p.inventoryCode, error: e.message }; }
    }), jobs,
  };
}

export async function enableInventorySync(expectedDestination, userId) {
  const preview = await previewInventorySync();
  if (!preview.destination || JSON.stringify(preview.destination) !== JSON.stringify(expectedDestination)) {
    throw Object.assign(new Error(preview.error || 'Catalog changed; preview again'), { statusCode: 409 });
  }
  await InventorySyncSettings.findOneAndUpdate({ _id: 'inventory' }, {
    $set: { enabled: true, destination: preview.destination, enabledBy: String(userId), enabledAt: new Date() },
  }, { upsert: true });
}

export async function runInventorySync({ client = createInventoryClient(), stockOnly = false } = {}) {
  if (!process.env.CATEREASE_INVENTORY_API_KEY) return;
  const lease = randomUUID();
  const settings = await InventorySyncSettings.findOneAndUpdate({
    _id: 'inventory', enabled: true,
    $or: [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }],
  }, { $set: { lease, lockedUntil: new Date(Date.now() + 10 * 60_000) } }, { new: true }).lean();
  if (!settings) return;
  const renew = async () => {
    const result = await InventorySyncSettings.updateOne({ _id: 'inventory', lease, enabled: true }, { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) } });
    if (!result.matchedCount) throw new Error('Inventory sync stopped');
  };
  try {
    const localProducts = await products();
    const existingJobs = await InventorySyncJob.find({}).select('_id status itemNum payload stockQuantity stockCheckedAt stockError').lean();
    const stockJobs = existingJobs.filter(j => j.status === 'sent' && j.itemNum)
      .sort((a, b) => new Date(a.stockCheckedAt || 0) - new Date(b.stockCheckedAt || 0));
    let stockCount = 0;
    for (const job of stockJobs) {
      const product = localProducts.find(p => String(p._id) === String(job._id));
      if (!product) continue;
      try {
        if (job.stockQuantity === inventoryStockPayload(product).invInstock && !job.stockError) continue;
      } catch { /* Record invalid quantities without writing zero. */ }
      if (stockCount++ >= 40) break;
      await renew();
      try {
        const stockQuantity = await syncInventoryStock(product, job, client);
        await InventorySyncJob.updateOne({ _id: job._id, status: 'sent', itemNum: job.itemNum }, { $set: { stockQuantity, stockError: '', stockCheckedAt: new Date() } });
      } catch (error) {
        await InventorySyncJob.updateOne({ _id: job._id, status: 'sent', itemNum: job.itemNum }, { $set: { stockError: error.message, stockCheckedAt: new Date() } });
      }
    }
    if (stockOnly) return;
    const known = new Set(existingJobs.map(j => String(j._id)));
    const completed = new Set(existingJobs.filter(j => ['sent', 'failed'].includes(j.status)).map(j => String(j._id)));
    if (localProducts.every(p => completed.has(String(p._id)))) return;
    const menus = await client.list('menu');
    const destination = inventoryDestination(menus, await client.list('foodservtype'));
    if (JSON.stringify(destination) !== JSON.stringify(settings.destination)) throw new Error('OCCDecks destination changed; preview and enable again');
    const remote = await client.list('menuitem');
    await renew();
    for (const product of localProducts) {
      if (known.has(String(product._id))) continue;
      await renew();
      let payload;
      try { payload = inventoryPayload(product, inventoryCategoryDestination(product, destination, menus)); }
      catch (e) {
        await InventorySyncJob.updateOne({ _id: String(product._id) }, { $setOnInsert: { status: 'failed', error: e.message, payload: { itemName: product.name, itemID: product.inventoryCode } } }, { upsert: true });
        continue;
      }
      await InventorySyncJob.updateOne({ _id: String(product._id) }, { $setOnInsert: { payload, idempotencyKey: randomUUID(), status: 'pending' } }, { upsert: true });
    }
    // Read every job after restart, including a create interrupted before its result was saved.
    const jobs = [
      ...await InventorySyncJob.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(40).lean(),
      ...await InventorySyncJob.find({ status: { $in: ['sending', 'review'] } }).sort({ updatedAt: 1 }).limit(10).lean(),
    ];
    for (const job of jobs) {
      await renew();
      const product = await Product.findById(job._id).select('_id').lean();
      if (!product) { await InventorySyncJob.updateOne({ _id: job._id }, { $set: { status: 'failed', error: 'Source product no longer exists' } }); continue; }
      if (job.status === 'pending') {
        const claim = await InventorySyncJob.updateOne({ _id: job._id, status: 'pending' }, { $set: { status: 'sending' } });
        if (!claim.modifiedCount) continue;
      }
      let result;
      try { result = await deliverInventoryJob(job, remote, client); }
      catch (e) { result = { status: 'review', error: e.message }; }
      await InventorySyncJob.updateOne({ _id: job._id }, { $set: { ...result, error: result.error || '' } });
      if (result.status === 'sent' && !remote.some(i => i.ItemNum === result.itemNum)) remote.push({ LocNum: job.payload.locNum, MenuNum: job.payload.menuNum, ItemID: job.payload.itemID, ItemName: job.payload.itemName, ItemNum: result.itemNum });
    }
    await InventorySyncSettings.updateOne({ _id: 'inventory', lease }, { $set: { lastRunAt: new Date(), lastError: '' } });
  } catch (error) {
    await InventorySyncSettings.updateOne({ _id: 'inventory', lease }, { $set: { lastError: error.message, lastRunAt: new Date() } });
  } finally {
    await InventorySyncSettings.updateOne({ _id: 'inventory', lease }, { $set: { lockedUntil: null, lease: '' } });
  }
}

export async function retryRejectedInventoryJobs({ client = createInventoryClient() } = {}) {
  const settings = await InventorySyncSettings.findById('inventory').lean();
  if (!settings?.destination) throw Object.assign(new Error('Preview and enable a catalog first'), { statusCode: 409 });
  const menus = await client.list('menu');
  const localProducts = new Map((await products()).map(p => [String(p._id), p]));
  let queued = 0;
  for (const job of await InventorySyncJob.find({ status: 'failed' }).lean()) {
    const product = localProducts.get(job._id);
    if (!product) continue;
    let payload;
    try { payload = inventoryPayload(product, inventoryCategoryDestination(product, settings.destination, menus)); } catch { continue; }
    const result = await InventorySyncJob.updateOne({ _id: job._id, status: 'failed' }, {
      $set: { payload, idempotencyKey: randomUUID(), status: 'pending', error: '' },
    });
    queued += result.modifiedCount;
  }
  return { queued };
}
