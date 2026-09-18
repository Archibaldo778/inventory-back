import JSZip from 'jszip';

const xmlText = (value = '') => String(value)
  .replace(/<w:tab\s*\/>/g, '\t')
  .replace(/<w:br\s*\/>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const cellText = (cellXml = '') => [...String(cellXml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => xmlText(match[1]))
  .filter(Boolean)
  .join(' ')
  .trim();

const parsedRow = (rowXml = '') => ({
  cells: [...String(rowXml).matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)]
    .map((match) => cellText(match[1])),
  merged: /<w:gridSpan\b/i.test(rowXml),
});

const cleanFileName = (fileName = '') => String(fileName).split(/[\\/]/).pop().replace(/\.docx$/i, '').trim();

export const kitchenPackOutBlueprintName = (fileName = '') => {
  const base = cleanFileName(fileName);
  const suffix = base.match(/(?:^|[_\s])KPO(?:[_\s-]+(.+))?$/i)?.[1]?.trim();
  return suffix || 'Kitchen Pack Out';
};

const headerIndex = (rows) => rows.findIndex(({ cells }) => {
  const joined = cells.join(' ').toLowerCase();
  return joined.includes('quantity') && joined.includes('not enough') && joined.includes('just enough');
});

export const parseKitchenPackOutBlueprint = async (buffer, fileName = '') => {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('The Word file does not contain a document body');
  const xml = await document.async('string');
  if (xml.length > 12 * 1024 * 1024) throw new Error('Kitchen Pack Out document is too large');
  const tableRows = [...xml.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)]
    .map((match) => parsedRow(match[1]));
  const start = headerIndex(tableRows);
  if (start < 0) throw new Error('Kitchen Pack Out column header was not found');

  const rows = tableRows.slice(start + 1, start + 2001).flatMap(({ cells }) => {
    const values = cells.map((value) => value.trim());
    const nonEmpty = values.filter(Boolean);
    if (!nonEmpty.length) return [];
    if (values.length === 1) {
      return [{ kind: 'heading', label: values[0] }];
    }
    const [itemName = '', quantityText = '', notEnough = '', justEnough = '', tooMuch = ''] = values;
    if (!itemName) return [];
    return [{ kind: 'item', itemName, quantityText, notEnough, justEnough, tooMuch }];
  });
  if (!rows.some((row) => row.kind === 'item')) throw new Error('No Kitchen Pack Out items were found');
  return {
    name: kitchenPackOutBlueprintName(fileName),
    fileName: String(fileName || '').trim(),
    rows,
  };
};
