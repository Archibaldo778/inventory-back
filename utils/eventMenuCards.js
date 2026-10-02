const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) invalid(`${label} must be text, at most ${max} characters`);
  return value.replace(/\r\n?/g, '\n').trim();
};
const number = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${label} must be between ${min} and ${max}`);
  return value;
};
const choice = (value, choices, label) => {
  if (!choices.includes(value)) invalid(`Invalid ${label}`);
  return value;
};

export const normalizeMenuCard = (value = {}) => {
  const name = text(value.name, 100, 'Card name');
  if (!name) invalid('Enter a card name');
  const source = value.design || {};
  const logoData = source.logoData || '';
  if (typeof logoData !== 'string' || logoData.length > 2_800_000) invalid('Logo must be a PNG image under 2 MB');
  if (logoData) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logoData)) invalid('Upload a PNG or JPG logo using the logo picker');
    const bytes = Buffer.from(logoData.split(',')[1], 'base64');
    if (bytes.length < 33 || bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.subarray(12, 16).toString() !== 'IHDR' || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)
      || bytes.readUInt32BE(16) > 1600 || bytes.readUInt32BE(20) > 1600) invalid('Logo image is invalid or too large');
  }
  if (!Array.isArray(source.sections) || source.sections.length < 1 || source.sections.length > 12) invalid('Use between 1 and 12 menu sections');
  const design = {
    width: number(source.width, 3, 12, 'Width'), height: number(source.height, 3, 12, 'Height'),
    frame: choice(source.frame, ['none', 'single', 'double', 'corners'], 'frame'),
    font: choice(source.font, ['helvetica', 'times'], 'font'),
    fontSize: number(source.fontSize, 8, 18, 'Text size'),
    spacing: number(source.spacing, 0.6, 1.6, 'Spacing'),
    alignment: choice(source.alignment, ['top', 'center'], 'vertical alignment'),
    logoMode: choice(source.logoMode, ['occ', 'none', 'client'], 'logo option'),
    logoWidth: number(source.logoWidth, 0.7, 2.5, 'Logo width'),
    logoData,
    title: text(source.title, 200, 'Printed title'),
    footer: text(source.footer, 500, 'Footer'),
    sections: source.sections.map((section) => ({
      heading: text(section?.heading, 200, 'Section heading'), body: text(section?.body, 5000, 'Menu text'),
    })),
  };
  if (design.sections.reduce((sum, section) => sum + section.body.length, 0) > 20_000) invalid('Menu text is too long');
  if (design.logoMode === 'client' && !logoData) invalid('Upload a client logo or choose another logo option');
  return { name, design };
};

export const menuCardRevision = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) invalid('A valid expectedRevision is required');
  return value;
};
