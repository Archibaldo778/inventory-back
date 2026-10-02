const names = [
  ['White Button Down Shirt', 'Shirt', 'White'], ['Black Button Down Shirt', 'Shirt', 'Black'],
  ['Grey Button Down Shirt', 'Shirt', 'Grey'], ['Checkered Shirt', 'Shirt', ''],
  ['Nehru White', 'Jacket', 'White'], ['Nehru Black', 'Jacket', 'Black'],
  ['Mandarin White', 'Jacket', 'White'], ['Mandarin Black', 'Jacket', 'Black'],
  ['Mandarin Green', 'Jacket', 'Green'], ['Mandarin Burgundy', 'Jacket', 'Burgundy'],
  ['White Polo', 'Shirt', 'White'], ['Black Polo', 'Shirt', 'Black'], ['SET-UP Polo', 'Shirt', ''],
  ['Black T-Shirt', 'Shirt', 'Black'], ['White T-Shirt', 'Shirt', 'White'],
  ['Khaki Pants', 'Pants', 'Khaki'], ['Dark Blue Jeans', 'Pants', 'Dark Blue'],
  ['Khaki Shorts', 'Pants', 'Khaki'], ['White Shorts', 'Pants', 'White'],
  ['SUIT Jacket Black', 'Jacket', 'Black'], ['BISTRO APRON BLK', 'Apron', 'Black'],
  ['White Sneakers', 'Shoes', 'White'], ['Phone Check Box', 'Equipment', ''], ['Laser Kit', 'Equipment', ''],
];
const letters = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export const uniformCatalogKey = (name) => {
  const clean = String(name).toLowerCase().replace(/button[ -]*down/g, '').replace(/\bshirts\b/g, 'shirt')
    .replace(/\bblk\b/g, 'black').replace(/\bgrey\b/g, 'gray').replace(/\bt[ -]shirt\b/g, 'tshirt')
    .replace(/\b(?:oc|occ)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bcheckered\b/.test(clean) && /\bshirt\b/.test(clean)) return 'checkered shirt';
  return clean.split(/\s+/).sort().join(' ');
};

// A plan only: reads and inserts are performed explicitly by the operator script.
export const planUniformCatalog = (existing, staffSizes = []) => names.flatMap(([name, category, color]) => {
  if (existing.some((item) => uniformCatalogKey(item.name) === uniformCatalogKey(name))) return [];
  let values = ['One size'];
  if (category === 'Shirt' || category === 'Jacket') values = letters;
  if (/^Mandarin /.test(name)) {
    const sameStyle = existing.find((item) => /mandarin/i.test(item.name) && item.sizes?.length);
    if (sameStyle) values = sameStyle.sizes.map((size) => size.label);
  }
  if (/^SUIT /.test(name)) values = staffSizes.map((person) => person.jacketSize).filter((size) => /^\d{1,2}[RSL]?$/i.test(String(size || '').trim()));
  if (category === 'Pants') values = [...existing.filter((item) => item.category === 'Pants').flatMap((item) => (item.sizes || []).map((size) => size.label)),
    ...staffSizes.map((person) => person.pantsSize)].map((size) => String(size || '').toUpperCase().replace(/\s+/g, '')).filter((size) => /^\d{1,2}(?:\.5)?(?:X\d{1,2}(?:\.5)?)?$/.test(size));
  if (/Shorts$/.test(name)) values = values.map((size) => String(size).split('X')[0]);
  if (category === 'Shoes') values = staffSizes.map((person) => String(person.shoeSize || '').trim()).filter((size) => /^\d{1,2}(?:\.5)?$/.test(size));
  // Match existing admin limits; prioritize the sizes most often recorded.
  const frequency = new Map();
  for (const value of values) { const label = String(value || '').trim(); if (label) frequency.set(label, (frequency.get(label) || 0) + 1); }
  const labels = [...frequency].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([label]) => label);
  return [{ name, category, color, quantity: 0, hidden: false, sizes: labels.map((label) => ({ label, quantity: 0 })) }];
});
