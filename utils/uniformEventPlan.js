const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const clean = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const sizeFields = ['', 'shirtSize', 'jacketSize', 'pantsSize', 'shoeSize'];

export const validateUniformEventItems = (items, catalog) => {
  if (!Array.isArray(items) || items.length > 100) fail('Use up to 100 custom items per event.');
  const ids = new Set(catalog.map((item) => String(item._id)));
  return items.map((item) => {
    const id = String(item?._id || '');
    const name = clean(item?.name);
    if (!/^[a-f0-9]{24}$/.test(id) || ids.has(id)) fail('Each event item must have its own ID.');
    if (!name || name.length > 120) fail('Enter an item name of 1–120 characters.');
    if (!sizeFields.includes(item.sizeField)) fail('Choose which staff sizes to use.');
    if (!Array.isArray(item.sizes) || item.sizes.length > 50) fail('Use up to 50 sizes per event item.');
    const labels = new Set();
    const sizes = item.sizes.map((row) => {
      const label = clean(row?.label);
      if (!label || label.length > 60 || labels.has(label.toLowerCase())) fail('Use unique size names of 1–60 characters.');
      labels.add(label.toLowerCase());
      return { label, quantity: 0 };
    });
    ids.add(id);
    return { _id: id, name, sizeField: item.sizeField, sizes };
  });
};

export const validateUniformEventPlan = (plan, catalog) => {
  if (plan === null) return null;
  if (!plan || !Array.isArray(plan.rows) || plan.rows.length > 100) fail('Use up to 100 uniform assignments.');
  if (typeof plan.notes !== 'string' || plan.notes.length > 1000) fail('Uniform instructions must be at most 1,000 characters.');
  const seen = new Set();
  const rows = plan.rows.map((row) => {
    const itemId = String(row?.itemId || '');
    if (!catalog.some((item) => String(item._id) === itemId && !item.hidden)) fail('Choose an existing item for every uniform assignment.');
    if (!['all', 'captains', 'event_staff', 'position'].includes(row.audience)) fail('Choose who needs this item.');
    const position = row.audience === 'position' ? clean(row.position) : '';
    if (row.audience === 'position' && (!position || position.length > 200)) fail('Choose a position.');
    const key = `${itemId}:${row.audience}:${position.toLowerCase()}`;
    if (seen.has(key)) fail('This uniform assignment is already listed.');
    seen.add(key);
    return { itemId, audience: row.audience, position };
  });
  return { rows, notes: plan.notes.trim() };
};
