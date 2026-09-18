import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import JSZip from 'jszip';
import mongoose from 'mongoose';
import CalendarReportStatus from '../models/CalendarReportStatus.js';

const APPLY = process.argv.includes('--apply');
const sourcePath = process.argv.find((argument) => /\.xlsx$/i.test(argument));
const databaseName = String(
  (process.argv.find((argument) => argument.startsWith('--database=')) || '').split('=').slice(1).join('=')
).trim();

if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error('Pass the previous calendar .xlsx path. Add --apply to perform the import.');
}
if (!databaseName) throw new Error('Pass the target database explicitly with --database=<name>.');

dotenv.config({ path: path.resolve('.env.development'), override: true });

const decodeXml = (value = '') => String(value)
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

const workbookRows = async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsFile
    ? [...(await sharedStringsFile.async('string')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
      .map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((textMatch) => decodeXml(textMatch[1]))
        .join(''))
    : [];
  const worksheet = zip.file('xl/worksheets/sheet1.xml');
  if (!worksheet) throw new Error('The workbook does not contain Sheet1.');
  const worksheetXml = await worksheet.async('string');
  return [...worksheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = { rowNumber: Number(rowMatch[1]) };
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const column = (attributes.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!column) continue;
      const cellXml = cellMatch[2] || '';
      const rawValue = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
      const inlineValue = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeXml(match[1]))
        .join('');
      row[column] = /\bt="s"/.test(attributes)
        ? sharedStrings[Number(rawValue)] || ''
        : inlineValue || decodeXml(rawValue);
    }
    return row;
  });
};

const rows = await workbookRows();
let columns = null;
const records = new Map();
for (const row of rows) {
  const entries = Object.entries(row).filter(([column]) => column !== 'rowNumber');
  const byLabel = Object.fromEntries(entries.map(([column, value]) => [clean(value).toUpperCase(), column]));
  if (byLabel['EVENT #'] && byLabel.SR && byLabel.KM && byLabel.PO) {
    columns = { event: byLabel['EVENT #'], sr: byLabel.SR, km: byLabel.KM, po: byLabel.PO };
    continue;
  }
  if (!columns) continue;
  const externalId = clean(row[columns.event]).toUpperCase();
  if (!/^E\d+$/.test(externalId)) continue;
  const values = {
    sr: clean(row[columns.sr]),
    km: clean(row[columns.km]),
    po: clean(row[columns.po]),
  };
  if (Object.values(values).some(Boolean)) records.set(externalId, values);
}

if (!records.size) throw new Error('No populated SR, KM or PO cells were found.');
const mongoUri = String(process.env.MONGO_URI_PROD || '').trim();
if (!mongoUri) throw new Error('MONGO_URI_PROD is not configured.');
await mongoose.connect(mongoUri, { dbName: databaseName });

const externalIds = [...records.keys()];
const existing = await CalendarReportStatus.find({ externalId: { $in: externalIds } }).lean();
const existingById = new Map(existing.map((status) => [String(status.externalId), status]));
const now = new Date();
const operations = [];
const fieldCounts = { sr: 0, km: 0, po: 0 };
for (const [externalId, values] of records) {
  const current = existingById.get(externalId);
  const set = {};
  for (const field of ['sr', 'km', 'po']) {
    if (!values[field] || clean(current?.[field]?.value)) continue;
    set[`${field}.value`] = values[field];
    set[`${field}.updatedAt`] = now;
    set[`${field}.updatedBy`] = 'Previous calendar import';
    set[`${field}.updatedById`] = 'calendar-migration';
    fieldCounts[field] += 1;
  }
  if (!Object.keys(set).length) continue;
  operations.push({
    updateOne: {
      filter: { externalId },
      update: {
        $set: { externalId, ...set },
        $setOnInsert: { eventKey: `legacy:${externalId}` },
      },
      upsert: true,
    },
  });
}

console.log(JSON.stringify({
  source: path.resolve(sourcePath),
  database: databaseName,
  populatedEvents: records.size,
  existingEvents: existing.length,
  pendingEvents: operations.length,
  pendingFields: fieldCounts,
  apply: APPLY,
}, null, 2));

if (APPLY && operations.length) {
  const result = await CalendarReportStatus.bulkWrite(operations, { ordered: false });
  console.log(JSON.stringify({ matched: result.matchedCount, modified: result.modifiedCount, upserted: result.upsertedCount }, null, 2));
}

await mongoose.disconnect();
