// Catalog categories remain unchanged; legacy shirt entries can be jackets too.
export const uniformClothingSlot = (part) => {
  const section = part.section || part.category;
  const name = String(part.name || '').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-');
  if (['Jackets', 'Mandarins', 'Nehru'].includes(section)
    || (section === 'Shirts' && /\b(mandarin|nehru|blazer|jacket)\b/i.test(name))) return 'Jackets';
  return ['Shirts', 'T-Shirts', 'Polos'].includes(section) ? 'Top' : section;
};
