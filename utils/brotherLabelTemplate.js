import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'product-1x1-static.lbx');
const INVENTORY_CODE_PATTERN = /^OCC\d{5,}$/;
const IMAGE_FILE_NAME = 'Object1.bmp';
const LABEL_WIDTH = 332;
const LABEL_HEIGHT = 320;

const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

let templateBufferPromise;

const loadTemplate = () => {
  templateBufferPromise ||= fs.readFile(TEMPLATE_PATH);
  return templateBufferPromise;
};

const createMonochromeBitmap = (width, height) => {
  const pixels = new Uint8Array(width * height);
  return {
    setBlack(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) pixels[(y * width) + x] = 1;
    },
    fillBlack(x, y, blockWidth, blockHeight) {
      for (let row = y; row < y + blockHeight; row += 1) {
        for (let column = x; column < x + blockWidth; column += 1) this.setBlack(column, row);
      }
    },
    toBmp() {
      const rowBytes = Math.ceil(width / 32) * 4;
      const pixelBytes = rowBytes * height;
      const dataOffset = 62;
      const output = Buffer.alloc(dataOffset + pixelBytes);
      output.write('BM', 0, 2, 'ascii');
      output.writeUInt32LE(output.length, 2);
      output.writeUInt32LE(dataOffset, 10);
      output.writeUInt32LE(40, 14);
      output.writeInt32LE(width, 18);
      output.writeInt32LE(height, 22);
      output.writeUInt16LE(1, 26);
      output.writeUInt16LE(1, 28);
      output.writeUInt32LE(0, 30);
      output.writeUInt32LE(pixelBytes, 34);
      output.writeInt32LE(14173, 38);
      output.writeInt32LE(14173, 42);
      output.writeUInt32LE(2, 46);
      output.writeUInt32LE(2, 50);
      output.fill(0, 54, 58);
      output.fill(0xff, 58, 62);
      output.fill(0xff, dataOffset);

      for (let y = 0; y < height; y += 1) {
        const targetRow = height - y - 1;
        const rowOffset = dataOffset + (targetRow * rowBytes);
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width) + x]) {
            output[rowOffset + Math.floor(x / 8)] &= ~(0x80 >> (x % 8));
          }
        }
      }
      return output;
    },
  };
};

const drawCenteredText = (bitmap, text, y, scale) => {
  const normalized = String(text || '').toUpperCase();
  const width = Math.max(0, ((normalized.length * 6) - 1) * scale);
  let cursorX = Math.floor((LABEL_WIDTH - width) / 2);
  for (const character of normalized) {
    const glyph = GLYPHS[character];
    if (glyph) {
      glyph.forEach((row, rowIndex) => {
        [...row].forEach((pixel, columnIndex) => {
          if (pixel === '1') bitmap.fillBlack(
            cursorX + (columnIndex * scale),
            y + (rowIndex * scale),
            scale,
            scale
          );
        });
      });
    }
    cursorX += 6 * scale;
  }
};

const createLabelBitmap = (qrValue, inventoryCode) => {
  const bitmap = createMonochromeBitmap(LABEL_WIDTH, LABEL_HEIGHT);
  const qr = QRCode.create(qrValue, { errorCorrectionLevel: 'M' }).modules;
  const quietZone = 4;
  const scale = Math.max(1, Math.floor(224 / (qr.size + (quietZone * 2))));
  const qrPixels = (qr.size + (quietZone * 2)) * scale;
  const startX = Math.floor((LABEL_WIDTH - qrPixels) / 2) + (quietZone * scale);
  const startY = 4 + (quietZone * scale);

  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (qr.get(row, column)) {
        bitmap.fillBlack(startX + (column * scale), startY + (row * scale), scale, scale);
      }
    }
  }

  drawCenteredText(bitmap, 'OLIVIER', 235, 3);
  drawCenteredText(bitmap, 'CHENG', 260, 2);
  drawCenteredText(bitmap, inventoryCode, 282, 3);
  return bitmap.toBmp();
};

const createImageObjectXml = () => `<image:image>
  <pt:objectStyle x="2.8pt" y="2pt" width="66.4pt" height="64pt" backColor="#FFFFFF" backPrintColorNumber="0" ropMode="COPYPEN" angle="0" anchor="TOPLEFT" flip="NONE">
    <pt:pen style="NULL" widthX="0.5pt" widthY="0.5pt" color="#000000" printColorNumber="1"/>
    <pt:brush style="NULL" color="#000000" printColorNumber="1" id="0"/>
    <pt:expanded objectName="LabelImage" ID="0" lock="2" templateMergeTarget="LABELLIST" templateMergeType="NONE" templateMergeID="0" linkStatus="NONE" linkID="0"/>
  </pt:objectStyle>
  <image:imageStyle originalName="${IMAGE_FILE_NAME}" alignInText="NONE" firstMerge="false" fileName="${IMAGE_FILE_NAME}">
    <image:transparent flag="false" color="#FFFFFF"/>
    <image:effect effect="NONE" brightness="50" contrast="50" photoIndex="0"/>
    <image:trimming flag="false" shape="RECTANGLE" trimOrgX="0pt" trimOrgY="0pt" trimOrgWidth="0pt" trimOrgHeight="0pt"/>
    <image:orgPos x="2.8pt" y="2pt" width="66.4pt" height="64pt"/>
    <image:mono operationKind="BINARY" reverse="0" ditherKind="MESH" threshold="128" gamma="100" ditherEdge="0" rgbconvProportionRed="50" rgbconvProportionGreen="50" rgbconvProportionBlue="50" rgbconvProportionReversed="0" viewMethod="0"/>
  </image:imageStyle>
</image:image>`;

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

  const labelXml = (await labelFile.async('string')).replace(
    /<pt:objects>[\s\S]*?<\/pt:objects>/,
    `<pt:objects>${createImageObjectXml()}</pt:objects>`
  );
  archive.file('label.xml', labelXml);
  archive.file(IMAGE_FILE_NAME, createLabelBitmap(qrValue, inventoryCode), { compression: 'STORE' });

  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
