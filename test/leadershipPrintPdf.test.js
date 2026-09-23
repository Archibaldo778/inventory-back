import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  createBoardPreviewsPdf,
  convertLeadershipFileToPdf,
  isLeadershipPrintFileSupported,
  mergeLeadershipPrintPdfs,
  prepareLeadershipFileForPdf,
} from '../utils/leadershipPrintPdf.js';
import JSZip from 'jszip';

const onePagePdf = async (width) => {
  const document = await PDFDocument.create();
  const page = document.addPage([width, 200]);
  page.drawText('Printable content', { x: 10, y: 10 });
  return Buffer.from(await document.save());
};

test('leadership printing accepts Office documents and existing PDFs only', () => {
  assert.equal(isLeadershipPrintFileSupported('Kitchen Menu.docx'), true);
  assert.equal(isLeadershipPrintFileSupported('Staff Request.xlsx'), true);
  assert.equal(isLeadershipPrintFileSupported('Rental Order.pdf'), true);
  assert.equal(isLeadershipPrintFileSupported('photo.jpg'), false);
});

test('existing PDF files pass through without invoking LibreOffice', async () => {
  const input = await onePagePdf(300);
  const output = await convertLeadershipFileToPdf({
    fileName: 'Tape Key.pdf',
    buffer: input,
    run: async () => { throw new Error('should not run'); },
  });
  assert.deepEqual(output, input);
});

test('SR revision spreadsheets are prepared as one landscape print page', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet><sheetViews/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
  const source = await zip.generateAsync({ type: 'nodebuffer' });
  const prepared = await prepareLeadershipFileForPdf({ fileName: '09-21-26 Chanel Climate Week Event SR REV2.xlsx', buffer: source });
  const output = await JSZip.loadAsync(prepared);
  const worksheet = await output.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(worksheet, /<pageSetUpPr fitToPage="1"\/>/);
  assert.match(worksheet, /<pageSetup[^>]*orientation="landscape"[^>]*fitToWidth="1"[^>]*fitToHeight="1"/);
  assert.match(worksheet, /<pageMargins left="0\.25"/);
});

test('Staff Request spreadsheet content is detected even when its file name is generic', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet><sheetViews/><sheetData><row><c t="inlineStr"><is><t>Staff Request Form</t></is></c></row></sheetData></worksheet>');
  const source = await zip.generateAsync({ type: 'nodebuffer' });
  const prepared = await prepareLeadershipFileForPdf({ fileName: 'Operations REV2.xlsx', buffer: source });
  const output = await JSZip.loadAsync(prepared);
  const worksheet = await output.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(worksheet, /orientation="landscape"/);
  assert.match(worksheet, /fitToHeight="1"/);
});

test('non-Staff Request spreadsheets are not rewritten', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet><sheetViews/><sheetData><row><c t="inlineStr"><is><t>Rental Order</t></is></c></row></sheetData></worksheet>');
  const input = await zip.generateAsync({ type: 'nodebuffer' });
  const output = await prepareLeadershipFileForPdf({ fileName: 'Rental Order.xlsx', buffer: input });
  assert.deepEqual(output, input);
});

test('leadership PDFs preserve file order and requested copy counts', async () => {
  const first = await onePagePdf(300);
  const second = await onePagePdf(500);
  const output = await mergeLeadershipPrintPdfs({
    documents: [
      { fileName: 'First.docx', buffer: Buffer.from('first'), copies: 2 },
      { fileName: 'Second.xlsx', buffer: Buffer.from('second'), copies: 1 },
    ],
    convert: async ({ fileName }) => (fileName === 'First.docx' ? first : second),
  });
  const merged = await PDFDocument.load(output);
  assert.equal(merged.getPageCount(), 3);
  assert.deepEqual(merged.getPages().map((page) => page.getSize()), [
    { width: 792, height: 612 },
    { width: 792, height: 612 },
    { width: 792, height: 612 },
  ]);
});

test('Kitchen Board previews become landscape Leadership File pages', async () => {
  // Use a tiny valid PNG fixture for the saved board preview.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const output = await createBoardPreviewsPdf({
    pages: [
      { preview: `data:image/png;base64,${png}` },
      { preview: 'not-an-image' },
      { preview: `data:image/png;base64,${png}` },
    ],
  });
  const merged = await PDFDocument.load(output);
  assert.equal(merged.getPageCount(), 2);
  assert.deepEqual(merged.getPages().map((page) => page.getSize()), [
    { width: 792, height: 612 },
    { width: 792, height: 612 },
  ]);
});

test('print PDF scales oversized portrait and landscape pages onto Letter sheets', async () => {
  const portraitDocument = await PDFDocument.create();
  const portraitPage = portraitDocument.addPage([1000, 2000]);
  portraitPage.drawText('Portrait content', { x: 10, y: 10 });
  const portrait = Buffer.from(await portraitDocument.save());
  const landscapeDocument = await PDFDocument.create();
  const landscapePage = landscapeDocument.addPage([2000, 1000]);
  landscapePage.drawText('Landscape content', { x: 10, y: 10 });
  const landscape = Buffer.from(await landscapeDocument.save());
  const output = await mergeLeadershipPrintPdfs({
    documents: [
      { fileName: 'Portrait.pdf', buffer: portrait, copies: 1 },
      { fileName: 'Floor Plan.pdf', buffer: landscape, copies: 1 },
    ],
  });
  const merged = await PDFDocument.load(output);
  assert.deepEqual(merged.getPages().map((page) => page.getSize()), [
    { width: 612, height: 792 },
    { width: 792, height: 612 },
  ]);
});

test('missing LibreOffice produces a clear configuration error', async () => {
  await assert.rejects(
    convertLeadershipFileToPdf({
      fileName: 'Kitchen Menu.docx',
      buffer: Buffer.from('docx'),
      run: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    }),
    (error) => error?.statusCode === 503 && /not configured/i.test(error.message)
  );
});
