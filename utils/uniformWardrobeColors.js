export const wardrobeColorFields = (body = {}) => {
  const colorName = String(body.colorName || '').trim();
  const swatch = String(body.swatch || '#808080').trim();
  if (!colorName || colorName.length > 60) throw new Error('Enter a color name (up to 60 characters)');
  if (!/^#[0-9a-f]{6}$/i.test(swatch)) throw new Error('Choose a valid color swatch');
  return { colorName, swatch, colorKey: colorName.toLowerCase() };
};
