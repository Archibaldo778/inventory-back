const clean = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 1000) : '';
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const nowstaUniformText = (source = {}) => [
  source.uniform_name, typeof source.uniform === 'string' ? source.uniform : source.uniform?.name,
  source.uniform_description, source.uniform?.description, source.dress_code,
].map(clean).filter((value, index, values) => value && values.indexOf(value) === index).join(' — ');

export const nowstaClothingSizes = (person = {}) => {
  const sources = [person, person.sizes, person.clothing_sizes, person.user, person.user?.sizes].filter(Boolean);
  const fields = { jacketSize: ['jacket_size', 'jacketSize'], shirtSize: ['shirt_size', 'shirtSize'],
    pantsSize: ['pants_size', 'pant_size', 'pantsSize'], shoeSize: ['shoe_size', 'shoes_size', 'shoeSize'], height: ['height'] };
  return Object.fromEntries(Object.entries(fields).map(([field, aliases]) => [field,
    sources.flatMap((source) => aliases.map((alias) => clean(source[alias]))).find(Boolean) || '',
  ]));
};

export const eventUniformRequirements = (entry, event) => {
  const requests = event?.catereaseOperations?.staffRequest || [];
  const positions = [...(entry.shifts || []).map((shift) => shift.position), ...requests.map((row) => row.position)]
    .filter((position, index, all) => position && all.findIndex((other) => key(other) === key(position)) === index);
  return positions.map((position) => {
    const shifts = (entry.shifts || []).filter((shift) => key(shift.position) === key(position));
    const nowsta = [...new Set(shifts.map((shift) => clean(shift.uniform)).filter(Boolean))];
    if (!nowsta.length && clean(entry.uniform || event?.meta?.nowsta?.uniform)) nowsta.push(clean(entry.uniform || event.meta.nowsta.uniform));
    const staffRequest = [...new Set(requests.filter((row) => key(row.position) === key(position)).map((row) => clean(row.uniform)).filter(Boolean))];
    return { position, uniform: nowsta.join(' / ') || staffRequest.join(' / '),
      source: nowsta.length ? 'Nowsta' : staffRequest.length ? 'Staff Request' : '',
      staffRequest: staffRequest.join(' / '),
      conflict: Boolean(nowsta.length && staffRequest.length && key(nowsta.join(' / ')) !== key(staffRequest.join(' / '))) };
  });
};
