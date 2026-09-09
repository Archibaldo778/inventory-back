import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import JSZip from 'jszip';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import Product from '../models/Product.js';
import { allocateDecorInventoryCodes } from '../utils/decorInventoryCodes.js';

const APPLY = process.argv.includes('--apply');
const sourcePath = process.argv.find((argument) => /\.xlsx$/i.test(argument));

if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error('Pass the source .xlsx path. Add --apply to perform the import.');
}

dotenv.config({ path: path.resolve('.env.development'), override: true });

const decodeXml = (value = '') => String(value)
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const normalizeName = (value) => String(value || '')
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^-\s*/, ''))
  .filter(Boolean)
  .join(' — ')
  .replace(/\s+/g, ' ')
  .trim();

const parseQuantity = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
    const number = Number(normalized);
    if (normalized && Number.isFinite(number) && number >= 0) return Math.trunc(number);
  }
  return 0;
};

const normalizeShelf = (value) => {
  const shelf = String(value || '').trim();
  if (/^in between shelf 1\s*&\s*2$/i.test(shelf)) return 'Basement · Between shelves 1 & 2';
  return `Basement · Shelf ${shelf || 'Unassigned'}`;
};

const readWorkbook = async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const readXml = async (name) => zip.file(name).async('string');
  const sharedStringsXml = await readXml('xl/sharedStrings.xml');
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(''));

  const worksheetXml = await readXml('xl/worksheets/sheet1.xml');
  const rows = [];
  for (const rowMatch of worksheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    if (rowNumber < 4) continue;
    const row = { rowNumber };
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const column = (attributes.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!column) continue;
      const rawValue = (cellMatch[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
      row[column] = /\bt="s"/.test(attributes)
        ? sharedStrings[Number(rawValue)]
        : decodeXml(rawValue);
    }
    rows.push(row);
  }

  const relationshipsXml = await readXml('xl/drawings/_rels/drawing1.xml.rels');
  const relationships = Object.fromEntries(
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((match) => [match[1], match[2].replace(/^\.\.\//, 'xl/')])
  );
  const drawingXml = await readXml('xl/drawings/drawing1.xml');
  const imagesByRow = new Map();
  for (const anchorMatch of drawingXml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g)) {
    const anchor = anchorMatch[1];
    const from = (anchor.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/) || [])[1] || '';
    const rowNumber = Number((from.match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1]) + 1;
    const relationshipId = (anchor.match(/r:embed="([^"]+)"/) || [])[1];
    const imagePath = relationships[relationshipId];
    if (!imagePath || !zip.file(imagePath)) continue;
    const rotation = Number((anchor.match(/<a:xfrm\b[^>]*rot="([^"]+)"/) || [])[1] || 0) / 60000;
    const rowImages = imagesByRow.get(rowNumber) || [];
    rowImages.push({ imagePath, rotation, buffer: await zip.file(imagePath).async('nodebuffer') });
    imagesByRow.set(rowNumber, rowImages);
  }

  return rows.map((row) => {
    const isMissingNameRow = row.rowNumber === 166 && /^\d+$/.test(String(row.C || '').trim());
    const isShiftedIdRow = row.rowNumber === 209 && !String(row.B || '').trim();
    const legacyInventoryId = isShiftedIdRow ? 'S4P206' : String(row.B || '').trim();
    const shelfValue = isShiftedIdRow ? '4' : row.A;
    const name = isMissingNameRow ? 'Caviar Gold Tin (S4P163)' : normalizeName(row.C);
    const quantity = parseQuantity(row.D, row.F, row.E);
    const location = normalizeShelf(shelfValue);
    return {
      rowNumber: row.rowNumber,
      legacyInventoryId,
      name,
      quantity,
      location,
      images: imagesByRow.get(row.rowNumber) || [],
    };
  });
};

const uploadImage = (record, image, index) => new Promise((resolve, reject) => {
  const publicId = `disposable-${record.legacyInventoryId.toLowerCase()}-${index + 1}`;
  const options = {
    folder: `${process.env.CLOUDINARY_INVENTORY_FOLDER || 'inventory'}/disposable-import`,
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
    format: 'jpg',
    ...(image.rotation ? { transformation: [{ angle: image.rotation }] } : {}),
  };
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) return reject(error);
    return resolve(result?.secure_url || result?.url || '');
  });
  stream.end(image.buffer);
});

const records = await readWorkbook();
const malformed = records.filter((record) => !record.legacyInventoryId || !record.name);
if (malformed.length) throw new Error(`Workbook contains ${malformed.length} unusable rows.`);

const mongoUri = String(process.env.MONGO_URI_PROD || '').trim();
if (!mongoUri) throw new Error('MONGO_URI_PROD is not configured.');
await mongoose.connect(mongoUri, process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

try {
  const sourceIds = records.map((record) => record.legacyInventoryId);
  const existing = await Product.find({ legacyInventoryId: { $in: sourceIds } }).lean();
  const existingById = new Map(existing.map((product) => [product.legacyInventoryId, product]));
  const missing = records.filter((record) => !existingById.has(record.legacyInventoryId));
  const imageCount = records.reduce((sum, record) => sum + record.images.length, 0);
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    database: mongoose.connection.name,
    workbookRows: records.length,
    embeddedImages: imageCount,
    existing: existing.length,
    toCreate: missing.length,
    withoutImages: records.filter((record) => !record.images.length).length,
    repairedRows: [
      { row: 166, action: 'Restored missing product name as Caviar Gold Tin (S4P163)' },
      { row: 209, action: 'Restored shifted shelf and product ID as Shelf 4 / S4P206' },
    ],
  }, null, 2));

  if (!APPLY) process.exitCode = 2;
  if (!APPLY) {
    await mongoose.disconnect();
    process.exit();
  }

  if (missing.length) {
    const codes = await allocateDecorInventoryCodes(missing.length);
    await Product.insertMany(missing.map((record, index) => ({
      inventoryCode: codes[index],
      legacyInventoryId: record.legacyInventoryId,
      inventoryType: 'disposable',
      name: record.name,
      quantity: record.quantity,
      locations: [{ name: record.location, quantity: record.quantity }],
      location: record.location,
      category: 'Disposable',
      description: `Imported from ${path.basename(sourcePath)} · Source ID ${record.legacyInventoryId}`,
      images: [],
    })), { ordered: true });
    console.log(`Created ${missing.length} disposable products.`);
  }

  const products = await Product.find({ legacyInventoryId: { $in: sourceIds } });
  const productsById = new Map(products.map((product) => [product.legacyInventoryId, product]));
  const pendingImages = records.filter((record) => {
    const product = productsById.get(record.legacyInventoryId);
    return record.images.length && (!Array.isArray(product?.images) || product.images.length < record.images.length);
  });
  let cursor = 0;
  let completed = 0;
  const failures = [];
  const worker = async () => {
    while (cursor < pendingImages.length) {
      const record = pendingImages[cursor++];
      try {
        const uploaded = [];
        for (let index = 0; index < record.images.length; index += 1) {
          uploaded.push(await uploadImage(record, record.images[index], index));
        }
        const imageUrls = uploaded.filter(Boolean);
        await Product.updateOne(
          { legacyInventoryId: record.legacyInventoryId },
          { $set: { image: imageUrls[0] || '', images: imageUrls } }
        );
      } catch (error) {
        failures.push({ legacyInventoryId: record.legacyInventoryId, message: error?.message || String(error) });
      }
      completed += 1;
      if (completed % 10 === 0 || completed === pendingImages.length) {
        console.log(`Images ${completed}/${pendingImages.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));

  const finalCount = await Product.countDocuments({ inventoryType: 'disposable' });
  console.log(JSON.stringify({ imported: records.length, finalDisposableCount: finalCount, imageFailures: failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
