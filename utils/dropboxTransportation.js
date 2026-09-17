import JSZip from 'jszip';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const decodeXml = (value) => String(value || '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const xmlText = (value) => decodeXml(
  [...String(value || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => match[1])
    .join('')
);

const columnIndex = (reference) => {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let value = 0;
  for (const letter of letters) value = (value * 26) + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
};

const workbookSheets = (workbookXml, relationshipsXml) => {
  const relationships = new Map(
    [...String(relationshipsXml || '').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map((match) => {
      const attributes = match[1];
      return [
        attributes.match(/\bId="([^"]+)"/)?.[1] || '',
        attributes.match(/\bTarget="([^"]+)"/)?.[1] || '',
      ];
    }).filter(([id, target]) => id && target)
  );
  return [...String(workbookXml || '').matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => {
    const attributes = match[1];
    const name = decodeXml(attributes.match(/\bname="([^"]+)"/)?.[1] || '');
    const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1] || '';
    const target = relationships.get(relationshipId) || '';
    return { name, path: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}` };
  });
};

const sheetMatrix = (sheetXml, sharedStrings) => (
  [...String(sheetXml || '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const content = cellMatch[2] || '';
      const reference = attributes.match(/\br="([^"]+)"/)?.[1] || '';
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || '';
      const raw = content.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
      let value = decodeXml(raw);
      if (type === 's') value = sharedStrings[Number(raw)] || '';
      if (type === 'inlineStr') value = xmlText(content);
      row[columnIndex(reference)] = value;
    }
    return row;
  })
);

const headerKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const excelTime = (value) => {
  const source = clean(value);
  const numeric = Number(source);
  if (!source || !Number.isFinite(numeric) || numeric < 0 || numeric >= 1) return source;
  const minutes = Math.round(numeric * 24 * 60) % (24 * 60);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
};

const unavailable = (value) => /^(?:n\/?a|none|0|-|\?)$/i.test(clean(value));
const timeLike = (value) => /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|a|p)\b/i.test(clean(value));

const normalizeTitle = (value) => clean(value)
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/wiliamsburg/g, 'williamsburg')
  .replace(/\bphilly\b/g, 'philadelphia')
  .replace(/\b(?:setup|travel|day|dry goods|beverage only|plans|for|inc|a)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const titleScore = (left, right) => {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.max(aTokens.size, bTokens.size);
};

const mergeDriverRows = (rows) => {
  const merged = new Map();
  rows.forEach((row) => {
    const key = `${headerKey(row.driver)}|${clean(row.phone).replace(/\D/g, '')}|${headerKey(row.vehicle)}`;
    const current = merged.get(key) || {
      name: row.driver,
      phone: row.phone,
      callTime: row.callTime,
      vehicle: row.vehicle,
      departureTime: '',
      arrivalTime: '',
      pickupTime: '',
      notes: [],
      address: row.address,
    };
    if (!current.callTime && row.callTime) current.callTime = row.callTime;
    if (!current.departureTime && row.departureTime && !unavailable(row.departureTime)) current.departureTime = row.departureTime;
    if (!current.arrivalTime && row.arrivalTime && !unavailable(row.arrivalTime) && timeLike(row.arrivalTime)) current.arrivalTime = row.arrivalTime;
    if (!current.pickupTime && row.pickupTime && !unavailable(row.pickupTime) && timeLike(row.pickupTime)) current.pickupTime = row.pickupTime;
    if (row.notes && !unavailable(row.notes) && !current.notes.includes(row.notes)) current.notes.push(row.notes);
    current.delivery = Boolean(current.arrivalTime);
    current.pickup = Boolean(current.pickupTime);
    current.role = current.delivery && current.pickup ? 'Delivery & Pickup' : current.delivery ? 'Delivery' : current.pickup ? 'Pickup' : 'Driver';
    merged.set(key, current);
  });
  return [...merged.values()].map((row) => ({ ...row, notes: row.notes.join(' · ') }));
};

export const parseTransportationWorkbook = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsFile
    ? [...(await sharedStringsFile.async('text')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]))
    : [];
  const workbookXml = await zip.file('xl/workbook.xml')?.async('text');
  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('text');
  const transportationSheet = workbookSheets(workbookXml, relationshipsXml)
    .find((sheet) => headerKey(sheet.name) === 'transportation');
  if (!transportationSheet) throw new Error('Transportation worksheet was not found');
  const sheetFile = zip.file(transportationSheet.path);
  if (!sheetFile) throw new Error('Transportation worksheet data is missing');
  const matrix = sheetMatrix(await sheetFile.async('text'), sharedStrings);
  const headerIndex = matrix.findIndex((row) => row.some((value) => headerKey(value) === 'event name'));
  if (headerIndex < 0) throw new Error('Transportation worksheet headers were not found');
  const headers = new Map([...matrix[headerIndex].entries()]
    .map(([index, value]) => [headerKey(value), index])
    .filter(([key]) => key));
  const read = (row, key) => clean(row[headers.get(key)]);
  const rows = matrix.slice(headerIndex + 1).map((row) => {
    const driver = [read(row, 'first'), read(row, 'last')].filter(Boolean).join(' ');
    return {
      eventName: read(row, 'event name'),
      driver,
      phone: read(row, 'phone'),
      callTime: excelTime(read(row, 'call time')),
      vehicle: read(row, 'vehicle'),
      departureTime: excelTime(read(row, 'departure time')),
      arrivalTime: excelTime(read(row, 'on site arrival')),
      pickupTime: excelTime(read(row, 'pick up')),
      notes: read(row, 'notes'),
      address: read(row, 'address'),
    };
  }).filter((row) => row.eventName && row.driver);
  return rows;
};

export const matchTransportationToEvents = (transportationRows = [], events = []) => {
  const groupedRows = new Map();
  transportationRows.forEach((row) => {
    const key = normalizeTitle(row.eventName);
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key).push(row);
  });
  const matches = [];
  const unmatched = [];
  const matchedEventIds = new Set();
  groupedRows.forEach((rows, key) => {
    const candidates = events
      .filter((event) => !matchedEventIds.has(String(event?._id || event?.id || '')))
      .map((event) => ({ event, score: titleScore(key, event?.title || event?.name) }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const next = candidates[1];
    if (!best || best.score < 0.5 || (next && best.score < 0.9 && best.score - next.score < 0.12)) {
      unmatched.push({ eventName: rows[0].eventName, drivers: rows.length });
      return;
    }
    matchedEventIds.add(String(best.event?._id || best.event?.id || ''));
    matches.push({
      event: best.event,
      sourceEventName: rows[0].eventName,
      drivers: mergeDriverRows(rows),
      score: best.score,
    });
  });
  return { matches, unmatched };
};

export const transportationFileName = (date) => {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}-${match[1]} Trans.xlsx` : '';
};

export const isTransportationTime = timeLike;
