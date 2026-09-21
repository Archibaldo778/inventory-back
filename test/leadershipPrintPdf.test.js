import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  convertLeadershipFileToPdf,
  isLeadershipPrintFileSupported,
  mergeLeadershipPrintPdfs,
} from '../utils/leadershipPrintPdf.js';

const onePagePdf = async (width) => {
  const document = await PDFDocument.create();
  document.addPage([width, 200]);
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
  assert.deepEqual(merged.getPages().map((page) => page.getWidth()), [300, 300, 500]);
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
