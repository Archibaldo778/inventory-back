import { uniformPackingPosition } from './uniformPacking.js';

const clean = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 1000) : '';
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameUniform = (instruction, request) => key(instruction) === key(request)
  || key(instruction.split(' — ')[0]) === key(request);

export const nowstaUniformText = (source = {}, uniforms = new Map()) => {
  const reference = uniforms.get(String(source.uniform_id ?? ''));
  return [
    source.uniform_name || (typeof source.uniform === 'string' ? source.uniform : source.uniform?.name) || reference?.name,
    source.uniform_description || source.uniform?.description || reference?.description, source.dress_code,
  ].map(clean).filter((value, index, values) => value && values.indexOf(value) === index).join(' — ');
};

export const nowstaClothingSizes = (person = {}) => {
  const sources = [person, person.sizes, person.clothing_sizes, person.user, person.user?.sizes].filter(Boolean);
  const fields = { jacketSize: ['jacket_size', 'jacketSize'], shirtSize: ['shirt_size', 'shirtSize'],
    pantsSize: ['pants_size', 'pant_size', 'pantsSize'], shoeSize: ['shoe_size', 'shoes_size', 'shoeSize'], height: ['height'] };
  const assignments = (Array.isArray(person.clothing_sizes) ? person.clothing_sizes : [])
    .filter((row) => !row.archived_at)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const labels = { jacketSize: ['jacket', 'jacket size'], shirtSize: ['shirt', 'shirt size'],
    pantsSize: ['pants', 'pants size'], shoeSize: ['shoes', 'shoe size', 'shoes size'], height: ['height'] };
  return Object.fromEntries(Object.entries(fields).map(([field, aliases]) => [field,
    sources.flatMap((source) => aliases.map((alias) => clean(source[alias]))).find(Boolean)
      || clean(assignments.find((row) => labels[field].includes(key(row.clothing_size_name)))?.value) || '',
  ]));
};

export const eventUniformRequirements = (entry, event) => {
  const requests = event?.catereaseOperations?.staffRequest || [];
  const positions = [...(entry.shifts || []).map((shift) => shift.position), ...requests.map((row) => row.position)]
    .filter((position, index, all) => position && uniformPackingPosition(position) && all.findIndex((other) => key(other) === key(position)) === index);
  const explicit = positions.map((position) => {
    const nowsta = [...new Set((entry.shifts || []).filter((shift) => key(shift.position) === key(position))
      .map((shift) => clean(shift.uniform)).filter(Boolean))];
    const staffRequest = [...new Set(requests.filter((row) => key(row.position) === key(position)).map((row) => clean(row.uniform)).filter(Boolean))];
    return { position, uniform: nowsta.join(' / ') || staffRequest.join(' / '),
      source: nowsta.length ? 'Nowsta' : staffRequest.length ? 'Staff Request' : '',
      staffRequest: staffRequest.join(' / '),
      conflict: Boolean(nowsta.length && staffRequest.length && (
        !nowsta.every((instruction) => staffRequest.some((request) => sameUniform(instruction, request)))
        || !staffRequest.every((request) => nowsta.some((instruction) => sameUniform(instruction, request)))
      )) };
  });
  const globalUniform = clean(entry.uniform || event?.meta?.nowsta?.uniform);
  const distinct = [...new Map(explicit.filter((row) => row.uniform).map((row) => [key(row.uniform.split(' — ')[0]), row.uniform])).values()];
  // Sales commonly enters the shared uniform on just one staffing row.
  const shared = globalUniform || (distinct.length === 1 ? distinct[0] : '');
  return explicit.map((row) => {
    if (row.uniform) return { ...row, selfProvided: false, inherited: false };
    if (/\bcaptain\b/i.test(row.position)) return { ...row,
      uniform: 'White Button Down Shirt + Black Tie — pack for every Captain, even if they bring their own.', source: 'Captain default', selfProvided: false, inherited: false };
    return { ...row, uniform: shared, source: shared ? 'Event uniform' : '', selfProvided: false, inherited: Boolean(shared) };
  });
};
