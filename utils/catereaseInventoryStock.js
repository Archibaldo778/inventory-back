export function inventoryStockPayload(product) {
  const value = product?.quantity;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new Error('Inventory total quantity is missing');
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999.9999) throw new Error('Inventory total quantity is outside Caterease limits');
  return { invItem: true, invInstock: Math.round(quantity * 10000) / 10000 };
}

export async function syncInventoryStock(product, job, client) {
  const payload = inventoryStockPayload(product);
  const read = async () => {
    const item = await client.readStock(job.itemNum, job.payload.locNum);
    if (item.ItemNum !== job.itemNum || item.LocNum !== job.payload.locNum
      || item.MenuNum !== job.payload.menuNum || item.Inactive
      || String(item.ItemID).trim().toUpperCase() !== String(product.inventoryCode).trim().toUpperCase()) {
      throw new Error('Caterease stock item identity mismatch');
    }
    return item;
  };
  const matches = item => item.InvItem === true && item.InvInstock != null && Number(item.InvInstock) === payload.invInstock;
  if (!matches(await read())) {
    await client.patchStock(job.itemNum, job.payload.locNum, payload);
    if (!matches(await read())) throw new Error('Caterease stock read-back did not match');
  }
  return payload.invInstock;
}
