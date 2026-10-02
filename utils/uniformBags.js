import { validateUniformLines } from './uniformPacking.js';

const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const key = (line) => `${line.itemId}:${String(line.size).trim().toLowerCase()}`;

export const validateUniformBags = (bags, lines, catalog) => {
  if (!Array.isArray(bags) || bags.length > 100) fail('Use up to 100 bags per event');
  const remaining = new Map(lines.map((line) => [key(line), line.quantity]));
  const ids = new Set(); const numbers = new Set();
  return bags.map((bag) => {
    if (!bag || typeof bag.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(bag.id) || ids.has(bag.id)) fail('Each bag needs a unique ID');
    if (!Number.isInteger(bag.number) || bag.number < 1 || bag.number > 9999 || numbers.has(bag.number)) fail('Each bag needs a unique positive number');
    if (typeof bag.notes !== 'string' || bag.notes.length > 400) fail('Bag notes must be at most 400 characters');
    if (!Array.isArray(bag.lines) || bag.lines.length > 12) fail('Use up to 12 item/size rows on a bag label');
    const contents = validateUniformLines(bag.lines, catalog);
    if (!contents.length) fail(`Bag ${bag.number} is empty. Add contents or remove it.`);
    for (const line of contents) {
      const available = remaining.get(key(line)) || 0;
      if (line.quantity > available) fail(`Bag quantities exceed the total for ${line.name}, size ${line.size}`);
      remaining.set(key(line), available - line.quantity);
    }
    ids.add(bag.id); numbers.add(bag.number);
    return { id: bag.id, number: bag.number, notes: bag.notes.trim(), lines: contents };
  });
};
