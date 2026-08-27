import {
  getPreparedBeverageRate,
  getPreparedBeverageType,
  isBarAccountingItem,
} from './barPackoutScope.js';

const cleanText = (value, maxLength = 500) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/[ \t\u00A0]+/g, ' ')
  .trim()
  .slice(0, maxLength);

export const normalizeOcrCatalogName = (value) => {
  const normalized = cleanText(value, 240)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cl|l|liters?|litres?|ounces?|oz)\b/g, ' ')
    .replace(/\b(?:bottle|bottles|case|cases|ml|cl|liters?|litres?|ounces?|oz)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\bott\b/.test(normalized) && /\brose\b/.test(normalized) && (/\bby ott\b/.test(normalized) || /\bcotes? de provence\b/.test(normalized))) {
    return 'domaines ott by ott rose';
  }
  if (/\bsancerre\b/.test(normalized) && /\breverdy\b/.test(normalized)) {
    return 'sancerre reverdy';
  }
  if (/\bpinot noir\b/.test(normalized) && /\bbench\b/.test(normalized)) {
    return 'bench pinot noir';
  }
  return normalized;
};

export const classifyRecognizedSection = (value) => {
  const section = cleanText(value, 160);
  if (!section) return 'review';
  if (/\b(?:staff|kitchen|sanitation|disposable|equipment|rental|linen|decor)\b/i.test(section)) {
    return 'non_bar';
  }
  if (/\b(?:alcohol|liquor|spirits?|wines?|champagne|prosecco|beer|cider|seltzer|vermouth|amaro|bitters)\b/i.test(section)) {
    return 'alcohol';
  }
  if (/\b(?:cocktails?|mocktails?|ice|waters?|garnish|mixers?|juices?|sodas?|beverages?|bar supplies?)\b/i.test(section)) {
    return 'bar_support';
  }
  return 'review';
};

const isUppercaseSection = (value) => {
  const text = cleanText(value, 160);
  const letters = text.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  return Boolean(letters) && text.length <= 100 && text === text.toUpperCase();
};

const normalizedHeader = (value) => cleanText(value, 80)
  .toLowerCase()
  .replace(/[^a-z]/g, '');

const findColumn = (cells, names) => {
  const expected = new Set(names.map(normalizedHeader));
  return cells.findIndex((cell) => expected.has(normalizedHeader(cell)));
};

const parseQuantity = (value) => {
  const text = cleanText(value, 80);
  if (!text) return { quantity: null, quantityText: '' };
  const match = text.replace(',', '.').match(/\d+(?:\.\d+)?/);
  const quantity = match ? Number(match[0]) : null;
  return {
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : null,
    quantityText: text,
  };
};

const inferPackoutType = (items) => {
  const scopes = new Set(items.map((item) => item.scope));
  if (scopes.has('non_bar')) return 'general';
  if (scopes.size === 1 && scopes.has('alcohol')) return 'alcohol_only';
  if (scopes.has('alcohol') || scopes.has('bar_support')) return 'bar_only';
  return 'unknown';
};

const metadataValue = (text, pattern) => {
  const match = String(text || '').match(pattern);
  return cleanText(match?.[1], 240);
};

const parseMetadata = (text) => ({
  eventName: metadataValue(text, /(?:^|\n)\s*Event\s*:\s*([^\n]+)/i),
  eventDate: metadataValue(text, /(?:^|\n)\s*Event\s+Date\s*:\s*([^\n]+)/i),
  salesRep: metadataValue(text, /(?:^|\n)\s*Sales\s+Rep\s*:\s*([^\n]+)/i),
  eventTiming: metadataValue(text, /(?:^|\n)\s*Event\s+Timing\s*:\s*([^\n]+)/i),
  guests: metadataValue(text, /(?:^|\n)\s*Guests?\s*:\s*([^\n]+)/i),
  deliveryTime: metadataValue(text, /(?:^|\n)\s*Delivery\s+Time\s*:\s*([^\n]+)/i),
  eventNumber: metadataValue(text, /(?:^|\n)\s*Event\s+Number\s*:\s*([^\n]+)/i),
  modifiedAt: metadataValue(text, /(?:^|\n)\s*Date\s+PO\s+Modified\s*:\s*([^\n]+)/i),
});

const parseRows = (rows, startSection = '', startScope = 'review', startIndex = 0) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) return { items: [], sections: [], section: startSection, scope: startScope };
  const headerIndex = sourceRows.findIndex((cells) => (
    findColumn(cells, ['Name', 'Item', 'Item Name']) >= 0
    && findColumn(cells, ['Qty', 'Quantity']) >= 0
  ));
  if (headerIndex < 0) return { items: [], sections: [], section: startSection, scope: startScope };
  const header = sourceRows[headerIndex];
  const columns = {
    name: findColumn(header, ['Name', 'Item', 'Item Name']),
    quantity: findColumn(header, ['Qty', 'Quantity']),
    notes: findColumn(header, ['Notes/Comments', 'Notes', 'Comments']),
    delivered: findColumn(header, ['Delivered']),
    returned: findColumn(header, ['Returned']),
  };
  const items = [];
  const sections = [];
  let currentSection = startSection;
  let currentScope = startScope;

  sourceRows.slice(headerIndex + 1).forEach((cells) => {
    const name = cleanText(cells[columns.name], 240);
    if (!name) return;
    const quantityCell = columns.quantity >= 0 ? cells[columns.quantity] : '';
    const otherValues = [
      quantityCell,
      columns.notes >= 0 ? cells[columns.notes] : '',
      columns.delivered >= 0 ? cells[columns.delivered] : '',
      columns.returned >= 0 ? cells[columns.returned] : '',
    ].filter((entry) => cleanText(entry));
    const classified = classifyRecognizedSection(name);
    if (otherValues.length === 0 && (classified !== 'review' || isUppercaseSection(name))) {
      currentSection = name;
      currentScope = classified;
      sections.push({ name, scope: classified });
      return;
    }
    const quantityState = parseQuantity(quantityCell);
    items.push({
      id: `google-scan-${startIndex + items.length + 1}`,
      name,
      section: currentSection,
      scope: currentScope,
      includedByDefault: currentScope === 'alcohol' || currentScope === 'bar_support',
      quantity: quantityState.quantity,
      quantityText: quantityState.quantityText,
      notes: columns.notes >= 0 ? cleanText(cells[columns.notes], 1000) : '',
      delivered: columns.delivered >= 0 ? cleanText(cells[columns.delivered], 80) : '',
      returned: columns.returned >= 0 ? cleanText(cells[columns.returned], 80) : '',
    });
  });
  return { items, sections, section: currentSection, scope: currentScope };
};

const parseFallbackText = (text, startIndex = 0) => {
  const rows = String(text || '').split(/\r?\n/).map((line) => cleanText(line, 500)).filter(Boolean);
  const items = [];
  const sections = [];
  let section = '';
  let scope = 'review';
  rows.forEach((line) => {
    if (/^(?:event|sales rep|guests?|delivery time|date po modified)\s*:/i.test(line)) return;
    const classified = classifyRecognizedSection(line);
    if (classified !== 'review' || isUppercaseSection(line)) {
      section = line;
      scope = classified;
      sections.push({ name: line, scope });
      return;
    }
    const match = line.match(/^(.+?)\s{2,}(\d+(?:[.,]\d+)?)(?:\s{2,}(.*))?$/);
    if (!match) return;
    const quantityState = parseQuantity(match[2]);
    items.push({
      id: `google-scan-${startIndex + items.length + 1}`,
      name: cleanText(match[1], 240),
      section,
      scope,
      includedByDefault: scope === 'alcohol' || scope === 'bar_support',
      quantity: quantityState.quantity,
      quantityText: quantityState.quantityText,
      notes: cleanText(match[3], 1000),
      delivered: '',
      returned: '',
    });
  });
  return { items, sections };
};

export const parseRecognizedPackout = ({ tables = [], text = '' } = {}) => {
  const items = [];
  const sections = [];
  let currentSection = '';
  let currentScope = 'review';
  (Array.isArray(tables) ? tables : []).forEach((table) => {
    const rows = [
      ...(Array.isArray(table?.headerRows) ? table.headerRows : []),
      ...(Array.isArray(table?.bodyRows) ? table.bodyRows : []),
    ];
    const parsed = parseRows(rows, currentSection, currentScope, items.length);
    items.push(...parsed.items);
    sections.push(...parsed.sections);
    currentSection = parsed.section;
    currentScope = parsed.scope;
  });
  if (!items.length) {
    const fallback = parseFallbackText(text);
    items.push(...fallback.items);
    sections.push(...fallback.sections);
  }
  const accountingItems = items.filter(isBarAccountingItem).map((item) => {
    const preparedBeverageType = getPreparedBeverageType(item);
    return {
      ...item,
      includedByDefault: true,
      preparedBeverageType,
      returnRequired: !preparedBeverageType,
      unitCostSnapshot: getPreparedBeverageRate(item) ?? undefined,
    };
  });
  return {
    metadata: parseMetadata(text),
    sections,
    items: accountingItems,
    packoutType: accountingItems.length ? inferPackoutType(accountingItems) : 'unknown',
  };
};

const bigrams = (value) => {
  const compact = value.replace(/\s+/g, ' ');
  if (compact.length < 2) return new Set([compact]);
  const result = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) result.add(compact.slice(index, index + 2));
  return result;
};

const diceScore = (left, right) => {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((entry) => { if (b.has(entry)) intersection += 1; });
  return (2 * intersection) / (a.size + b.size);
};

const tokenScore = (left, right) => {
  const a = new Set(left.split(' ').filter((token) => token.length > 1));
  const b = new Set(right.split(' ').filter((token) => token.length > 1));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((entry) => { if (b.has(entry)) intersection += 1; });
  return intersection / Math.max(a.size, b.size);
};

const similarity = (left, right) => Math.max(diceScore(left, right), tokenScore(left, right));

export const matchRecognizedItemsToCatalog = (items, catalog) => {
  const catalogRows = (Array.isArray(catalog) ? catalog : []).map((entry) => ({
    id: String(entry?._id || entry?.id || ''),
    name: cleanText(entry?.name, 240),
    values: [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
      .map(normalizeOcrCatalogName)
      .filter(Boolean),
  })).filter((entry) => entry.id && entry.name && entry.values.length);

  return (Array.isArray(items) ? items : []).map((item) => {
    const source = normalizeOcrCatalogName(item?.name);
    if (!source) return { ...item, beverageItemId: null, catalogMatch: { status: 'unmatched', confidence: 0 } };
    const sourceValues = [source];
    if (/^assorted$/i.test(String(item?.name || '').trim()) && /\bbeer\b/i.test(String(item?.section || ''))) {
      sourceValues.push(normalizeOcrCatalogName(`Beer ${item.name}`));
    }
    const ranked = catalogRows.map((entry) => {
      const exact = sourceValues.some((value) => entry.values.includes(value));
      const score = exact ? 1 : Math.max(...sourceValues.flatMap((sourceValue) => (
        entry.values.map((value) => similarity(sourceValue, value))
      )));
      return { ...entry, exact, score };
    }).sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score < 0.56) {
      return { ...item, beverageItemId: null, catalogMatch: { status: 'unmatched', confidence: best?.score || 0 } };
    }
    const confident = best.exact || (best.score >= 0.9 && (best.score - (runnerUp?.score || 0)) >= 0.12);
    const status = best.exact ? 'exact' : (confident ? 'likely' : 'suggested');
    return {
      ...item,
      beverageItemId: confident ? best.id : null,
      catalogMatch: {
        status,
        confidence: Math.round(best.score * 100) / 100,
        beverageItemId: best.id,
        name: best.name,
      },
    };
  });
};

export const keepBarAccountingItems = (items) => (Array.isArray(items) ? items : [])
  .filter(isBarAccountingItem)
  .map((item) => {
    const preparedBeverageType = getPreparedBeverageType(item);
    return {
      ...item,
      includedByDefault: true,
      preparedBeverageType,
      returnRequired: !preparedBeverageType,
      unitCostSnapshot: getPreparedBeverageRate(item) ?? item?.unitCostSnapshot,
    };
  });
