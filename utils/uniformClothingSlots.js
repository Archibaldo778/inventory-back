// Keep catalog categories intact, including user-created jacket categories.
export const uniformClothingSlot = (part) => {
  const section = part.section || part.category;
  const name = String(part.name || '').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-');
  const category = String(section || '').normalize('NFKC').trim().toLowerCase();
  if (!['body', 'pants', 'ties', 'belts', 'shoes', 'aprons', 'vests', 'accessories'].includes(category)
    && /\b(mandarins?|nehru|blazers?|jackets?)\b/i.test(`${category} ${name}`)) return 'Jackets';
  return ['Shirts', 'T-Shirts', 'Polos'].includes(section) ? 'Top' : section;
};
