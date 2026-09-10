import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'product-1x1-static.lbx');
const INVENTORY_CODE_PATTERN = /^OCC\d{5,}$/;

let templateBufferPromise;

const loadTemplate = () => {
  templateBufferPromise ||= fs.readFile(TEMPLATE_PATH);
  return templateBufferPromise;
};

const replaceObjectData = (xml, objectName, value) => {
  const escapedName = objectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(<(?:barcode:barcode|text:text)>[\\s\\S]*?<pt:expanded[^>]*objectName="${escapedName}"[^>]*>[\\s\\S]*?<pt:data>)[\\s\\S]*?(<\\/pt:data>)`
  );
  if (!pattern.test(xml)) throw new Error(`Brother template object ${objectName} is missing`);
  return xml.replace(pattern, `$1${value}$2`);
};

export const createBrotherProductLabel = async (rawInventoryCode, appOrigin = 'https://occdecks.com') => {
  const inventoryCode = String(rawInventoryCode || '').trim().toUpperCase();
  if (!INVENTORY_CODE_PATTERN.test(inventoryCode)) {
    const error = new Error('Invalid inventory code');
    error.statusCode = 400;
    throw error;
  }

  const cleanOrigin = String(appOrigin || 'https://occdecks.com').trim().replace(/\/$/, '');
  const qrValue = `${cleanOrigin}/i/${inventoryCode}`;
  const archive = await JSZip.loadAsync(await loadTemplate());
  const labelFile = archive.file('label.xml');
  if (!labelFile) throw new Error('Brother template label.xml is missing');

  let labelXml = await labelFile.async('string');
  labelXml = replaceObjectData(labelXml, 'QRCode', qrValue);
  labelXml = replaceObjectData(labelXml, 'InventoryCode', inventoryCode);
  archive.file('label.xml', labelXml);

  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
