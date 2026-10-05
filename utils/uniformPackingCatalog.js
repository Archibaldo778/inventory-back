const clean = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const packingCatalogFields = (body) => {
  const name = clean(body?.name);
  const size = clean(body?.size) || 'One size';
  if (!name || name.length > 120) throw Object.assign(new Error('Enter an item name of 1–120 characters.'), { statusCode: 400 });
  if (size.length > 60 || (body?.size != null && typeof body.size !== 'string')) throw Object.assign(new Error('Enter a size of 1–60 characters.'), { statusCode: 400 });
  return { name, sizes: [{ label: size, quantity: 0 }], quantity: 0, hidden: false };
};

export const findOrCreatePackingItem = async (body, Model) => {
  const fields = packingCatalogFields(body);
  const escaped = fields.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = await Model.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } });
  if (existing?.hidden) throw Object.assign(new Error('This item is hidden. Ask an administrator to restore it in the uniform catalog.'), { statusCode: 409 });
  if (existing) return { item: existing, created: false };
  return { item: await Model.create(fields), created: true };
};
