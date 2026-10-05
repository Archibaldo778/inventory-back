const clean = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const packingCatalogFields = (body) => {
  const name = clean(body?.name);
  const size = clean(body?.size) || 'One size';
  if (!name || name.length > 120) throw Object.assign(new Error('Enter an item name of 1–120 characters.'), { statusCode: 400 });
  if (size.length > 60 || (body?.size != null && typeof body.size !== 'string')) throw Object.assign(new Error('Enter a size of 1–60 characters.'), { statusCode: 400 });
  const fields = { name, sizes: [{ label: size, quantity: 0 }], quantity: 0, hidden: false };
  if (body?.sizeField !== undefined) {
    if (!['', 'shirtSize', 'jacketSize', 'pantsSize', 'shoeSize'].includes(body.sizeField)) throw Object.assign(new Error('Choose which staff sizes to use.'), { statusCode: 400 });
    fields.sizeField = body.sizeField;
    if (Array.isArray(body.sizes)) {
      if (body.sizes.length > 50) throw Object.assign(new Error('Use up to 50 sizes.'), { statusCode: 400 });
      const labels = [...new Set(body.sizes.map((row) => clean(row?.label)))];
      if (labels.some((label) => !label || label.length > 60)) throw Object.assign(new Error('Enter size names of 1–60 characters.'), { statusCode: 400 });
      fields.sizes = labels.map((label) => ({ label, quantity: 0 }));
    }
  }
  return fields;
};

export const findOrCreatePackingItem = async (body, Model) => {
  const fields = packingCatalogFields(body);
  const escaped = fields.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = await Model.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } });
  if (existing?.hidden) throw Object.assign(new Error('This item is hidden. Ask an administrator to restore it in the uniform catalog.'), { statusCode: 409 });
  if (existing) return { item: existing, created: false };
  return { item: await Model.create(fields), created: true };
};
