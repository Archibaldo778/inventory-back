import JSZip from 'jszip';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const decodeXml = (value) => String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlText = (value) => decodeXml([...String(value || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(''));
const columnIndex = (reference) => {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let value = 0;
  for (const letter of letters) value = (value * 26) + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
};
const matrix = (xml, sharedStrings) => [...String(xml || '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
  const row = [];
  for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = cell[1];
    const content = cell[2] || '';
    const raw = content.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
    const type = attributes.match(/\bt="([^"]+)"/)?.[1] || '';
    const value = type === 's' ? sharedStrings[Number(raw)] || '' : type === 'inlineStr' ? xmlText(content) : decodeXml(raw);
    row[columnIndex(attributes.match(/\br="([^"]+)"/)?.[1])] = clean(value);
  }
  return row;
});

export const parseOperationsDriversWorkbook = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/workbook.xml')?.async('text');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('text');
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const sharedXml = sharedFile ? await sharedFile.async('text') : '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]));
  const relationship = new Map([...String(rels || '').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map((match) => [
    match[1].match(/\bId="([^"]+)"/)?.[1],
    match[1].match(/\bTarget="([^"]+)"/)?.[1],
  ]));
  const sheet = [...String(workbook || '').matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => ({
    name: decodeXml(match[1].match(/\bname="([^"]+)"/)?.[1] || ''),
    target: relationship.get(match[1].match(/\br:id="([^"]+)"/)?.[1]),
  })).find((item) => clean(item.name).toLowerCase() === 'drivers info');
  if (!sheet?.target) throw new Error('The workbook does not contain a drivers info sheet');
  const path = sheet.target.startsWith('/') ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, '')}`;
  const rows = matrix(await zip.file(path)?.async('text'), shared);
  const headerIndex = rows.findIndex((row) => row.some((value) => /first name/i.test(value)) && row.some((value) => /last name/i.test(value)));
  if (headerIndex < 0) throw new Error('Driver headers were not found');
  const headers = rows[headerIndex].map((value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const find = (...patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const firstIndex = find(/^first name$/);
  const lastIndex = find(/^last name$/);
  const phoneIndex = find(/cell phone/, /^phone$/);
  const emailIndex = find(/email/);
  return rows.slice(headerIndex + 1).map((row) => ({
    firstName: clean(row[firstIndex]),
    lastName: clean(row[lastIndex]),
    phone: phoneIndex >= 0 ? clean(row[phoneIndex]) : '',
    email: emailIndex >= 0 ? clean(row[emailIndex]).toLowerCase() : '',
  })).filter((person) => person.firstName || person.lastName);
};
