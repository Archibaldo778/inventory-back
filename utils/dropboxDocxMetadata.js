import JSZip from 'jszip';
import { parseRecognizedPackout } from './barPackoutRecognition.js';

const MAX_DOCX_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;

const clean = (value) => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

const decodeXmlEntities = (value) => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const fragmentText = (fragment) => decodeXmlEntities(String(fragment || '')
  .replace(/<w:tab\b[^>]*\/>/gi, ' ')
  .replace(/<w:br\b[^>]*\/>/gi, ' ')
  .replace(/<\/w:p>/gi, ' ')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \u00a0]+/g, ' ')
  .trim();

export const extractDropboxDocxLines = (xml) => {
  const lines = [];
  const blocks = String(xml || '').match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/gi) || [];
  blocks.forEach((block) => {
    if (/^<w:tbl\b/i.test(block)) {
      const rows = block.match(/<w:tr\b[\s\S]*?<\/w:tr>/gi) || [];
      rows.forEach((row) => {
        const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/gi) || []).map(fragmentText).filter(Boolean);
        if (cells.length) lines.push(cells.join('\t'));
      });
      return;
    }
    const value = fragmentText(block);
    if (value) lines.push(value);
  });
  return lines;
};

const metadataValue = (text, patterns) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (clean(match?.[1])) return clean(match[1]);
  }
  return '';
};

const normalizeDate = (value) => {
  const source = clean(value);
  const iso = source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (us) return `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
};

const normalizeEventId = (value) => {
  const match = clean(value).toUpperCase().match(/\bE\s*[-_ ]?\s*(\d{2,})\b/);
  return match ? `E${match[1]}` : '';
};

const MENU_START_RE = /^MENU$/i;
const MENU_END_RE = /^BEVERAGES?$/i;
const STAFF_MEAL_RE = /^(?:\d+\s+)?STAFF\s+MEAL$/i;
const TABLE_HEADER_RE = /^(?:QTY|ITEM|COMMENT|LABEL(?:\s+\(.*\))?)$/i;
const NON_DISH_RE = /^(?:choice\s+of|included|requires?\b|pack\b|same\b.*\bas\s+guests?\b|option\s+[a-z]\b|chef(?:'|’)?s\s+choice\b|silent\s+vegetarian\s+option\b|\$?\d+(?:\.\d+)?\s*(?:pp)?\s*supplement\b|supplement\b)/i;
const DIETARY_TOKEN_RE = /\b(?:GF|DF|NF|V|VG|VEGAN|VEGETARIAN)\b/gi;
const ALCOHOL_RE = /\b(?:absinthe|amaretto|amaro|aperol|beer|bitters?|bourbon|brandy|campari|champagne|chartreuse|cider|cognac|cointreau|gin|liqueur|mezcal|prosecco|rum|rye|sake|sancerre|scotch|sherry|tequila|vermouth|vodka|whisk(?:e)?y|wine)\b/i;

const uppercaseHeading = (value) => {
  const text = clean(value);
  const letters = text.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  return Boolean(letters) && text.length <= 120 && letters === letters.toUpperCase();
};

const normalizeKitchenName = (value) => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’‘`]/g, "'")
  .replace(/\([^)]*\b(?:GF|DF|NF|V|VG|VEGAN|VEGETARIAN)\b[^)]*\)/gi, ' ')
  .replace(DIETARY_TOKEN_RE, ' ')
  .replace(/\$?\d+(?:\.\d+)?\s*(?:pp|per\s+person)?\s*supplement\b/gi, ' ')
  .replace(/\bsupplement\b/gi, ' ')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/gi, ' ')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

export const parseDropboxKitchenItems = (text) => {
  const rows = String(text || '').replace(/\r/g, '').split('\n')
    .map((line) => line.split('\t').map((cell) => clean(cell)));
  const menuStart = rows.findIndex((cells) => cells.some((cell) => MENU_START_RE.test(cell)));
  if (menuStart < 0) return [];
  const beverageOffset = rows.slice(menuStart + 1)
    .findIndex((cells) => cells.some((cell) => MENU_END_RE.test(cell)));
  const menuEnd = beverageOffset >= 0 ? menuStart + 1 + beverageOffset : rows.length;
  const items = [];
  const seen = new Set();
  let section = '';
  let itemColumn = -1;
  for (const cells of rows.slice(menuStart + 1, menuEnd)) {
    const headerColumn = cells.findIndex((cell) => /^ITEM$/i.test(cell));
    if (headerColumn >= 0) {
      itemColumn = headerColumn;
      continue;
    }
    const line = clean(itemColumn >= 0 ? cells[itemColumn] : cells.find(Boolean)).replace(/^[•·▪◦]\s*/, '');
    if (!line || TABLE_HEADER_RE.test(line)) continue;
    if (STAFF_MEAL_RE.test(line)) break;
    if (uppercaseHeading(line)) {
      section = line;
      continue;
    }
    if (/^\d+$/.test(line) || NON_DISH_RE.test(line)) continue;
    if (/^(?:GLASS|GARNISH|ALLERGEN|EVENT|CLIENT|VENUE)\s*:/i.test(line)) continue;
    const normalizedName = normalizeKitchenName(line);
    if (line.length < 4 || !/[A-Za-z]/.test(line) || normalizedName.split(' ').length < 2 || seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    items.push({ name: line, normalizedName, section });
  }
  return items;
};

const kitchenBarSection = (name) => {
  if (/\bmocktails?\b/i.test(name)) return 'MOCKTAIL';
  if (/\bcocktails?\b/i.test(name)) return 'COCKTAIL';
  if (/\b(?:champagne|prosecco|sparkling)\b/i.test(name)) return 'SPARKLING WINE';
  if (/\b(?:wine|sancerre|sherry)\b/i.test(name)) return 'WINE';
  return 'SPIRITS';
};

export const parseDropboxKitchenBarItems = (text) => {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .flatMap((line) => line.split('\t')).map(clean).filter(Boolean);
  const start = lines.findIndex((line) => MENU_END_RE.test(line));
  if (start < 0) return [];
  const stopOffset = lines.slice(start + 1).findIndex((line) => /^STAFFING INFO$/i.test(line));
  const stop = stopOffset >= 0 ? start + 1 + stopOffset : lines.length;
  const items = [];
  const seen = new Set();
  let preparedType = '';
  for (let index = start + 1; index < stop; index += 1) {
    const line = lines[index];
    if (/^(?:\d+\s+)?SPECIALTY MOCKTAILS?\b/i.test(line)) {
      preparedType = 'mocktail';
      continue;
    }
    if (/^(?:\d+\s+)?(?:SPECIALTY )?COCKTAILS?\b/i.test(line)) {
      preparedType = 'cocktail';
      continue;
    }
    if (/^(?:QTY|ITEM|COMMENT|LABEL|BEVERAGE|MENU|STAFF|GLASS|GARNISH|ICE|WATER|JUICE|SODA)\b/i.test(line)) continue;
    const next = lines[index + 1] || '';
    const ingredientList = next.includes(',') && !uppercaseHeading(next);
    if (preparedType && uppercaseHeading(line) && ingredientList) {
      const key = `prepared:${normalizeKitchenName(line)}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          name: line,
          section: preparedType === 'mocktail' ? 'MOCKTAIL' : 'COCKTAIL',
          scope: 'review',
          includedByDefault: true,
          preparedBeverageType: preparedType,
          returnRequired: false,
          unitCostSnapshot: preparedType === 'mocktail' ? 1.5 : 3,
          quantity: null,
          quantityText: '',
          notes: `Kitchen Menu ingredients: ${next}`,
        });
      }
      index += 1;
      continue;
    }
    if (ALCOHOL_RE.test(line) && !/^(?:SPECIALTY|ALSO AVAILABLE|SPIRIT|BAR)\b/i.test(line)) {
      const key = `alcohol:${normalizeKitchenName(line)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        name: line,
        section: kitchenBarSection(line),
        scope: 'alcohol',
        includedByDefault: true,
        returnRequired: true,
        quantity: 0,
        quantityText: 'Pending captain count',
        sentQtyPending: true,
        notes: 'Listed in Kitchen Menu; quantity to be confirmed by captain',
      });
    }
  }
  return items;
};

export const parseDropboxDocxMetadataText = (text) => {
  const source = clean(text).replace(/\r/g, '\n');
  const eventTitle = metadataValue(source, [
    /(?:^|\n|\t)\s*Event\s+Name\s*:\s*([^\n\t]+)/i,
    /(?:^|\n|\t)\s*Event\s*:\s*([^\n\t]+)/i,
  ]);
  const eventDateRaw = metadataValue(source, [
    /(?:^|\n|\t)\s*Event\s+Date\s*:\s*([^\n\t]+)/i,
    /(?:^|\n|\t)\s*Date\s*:\s*([^\n\t]+)/i,
  ]);
  const eventIdRaw = metadataValue(source, [
    /(?:^|\n|\t)\s*Event\s+(?:Number|ID)\s*:\s*([^\n\t]+)/i,
  ]);
  const kitchenSignals = [
    /(?:^|\n|\t)\s*Event\s+Name\s*:/i,
    /(?:^|\n|\t)\s*Guest\s+Count\s*:/i,
    /(?:^|\n|\t)\s*MENU\s*(?:\n|\t|$)/i,
    /(?:^|\n|\t)\s*BEVERAGES?\s*(?:\n|\t|$)/i,
  ].filter((pattern) => pattern.test(source)).length;
  const poSignals = [
    /(?:^|\n|\t)\s*Date\s+PO\s+Modified\s*:/i,
    /(?:^|\n|\t)\s*(?:Name|Item)\s*\t\s*(?:Qty|Quantity)\b/i,
    /(?:^|\n|\t)\s*Delivery\s+Time\s*:/i,
  ].filter((pattern) => pattern.test(source)).length;
  return {
    eventId: normalizeEventId(eventIdRaw),
    eventTitle,
    eventDate: normalizeDate(eventDateRaw),
    documentType: kitchenSignals > poSignals && kitchenSignals >= 2
      ? 'kitchen_menu'
      : (poSignals >= 2 ? 'po' : 'review'),
  };
};

export const readDropboxDocxMetadata = async (buffer, { documentType: typeHint = 'review' } = {}) => {
  const size = Number(buffer?.byteLength ?? buffer?.length);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Dropbox returned an empty DOCX file');
  if (size > MAX_DOCX_BYTES) throw new Error('DOCX file exceeds the 100 MB inspection limit');
  const archive = await JSZip.loadAsync(buffer);
  const documentEntry = archive.file('word/document.xml');
  if (!documentEntry) throw new Error('File is not a supported DOCX document');
  const uncompressedSize = Number(documentEntry?._data?.uncompressedSize);
  if (Number.isFinite(uncompressedSize) && uncompressedSize > MAX_DOCUMENT_XML_BYTES) {
    throw new Error('DOCX document body exceeds the inspection limit');
  }
  const xml = await documentEntry.async('string');
  const lines = extractDropboxDocxLines(xml);
  const text = lines.join('\n');
  const metadata = parseDropboxDocxMetadataText(text);
  const documentType = metadata.documentType !== 'review' ? metadata.documentType : typeHint;
  if (documentType === 'kitchen_menu') {
    return {
      ...metadata,
      documentType,
      kitchenItems: parseDropboxKitchenItems(text),
      barItems: parseDropboxKitchenBarItems(text),
      packoutType: 'bar_only',
    };
  }
  const packout = parseRecognizedPackout({
    tables: [{ bodyRows: lines.map((line) => line.split('\t').map(clean)) }],
    text,
  });
  return {
    ...metadata,
    documentType,
    kitchenItems: [],
    barItems: packout.items,
    packoutType: packout.packoutType,
  };
};
