import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);
const clean = (value) => String(value || '').trim();

const OFFICE_EXTENSIONS = new Set([
  'doc', 'docx', 'docm', 'dot', 'dotx',
  'xls', 'xlsx', 'xlsm', 'ods',
  'ppt', 'pptx', 'pptm', 'odp',
  'odt', 'rtf', 'txt',
]);

const extensionOf = (fileName) => clean(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
const printableFileName = (fileName) => clean(fileName)
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 180) || 'event-document.docx';
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export const isLeadershipPrintFileSupported = (fileName) => {
  const extension = extensionOf(fileName);
  return extension === 'pdf' || OFFICE_EXTENSIONS.has(extension);
};

export const convertLeadershipFileToPdf = async ({
  fileName,
  buffer,
  libreOfficeBin = process.env.LIBREOFFICE_BIN || 'soffice',
  run = execFileAsync,
}) => {
  const extension = extensionOf(fileName);
  if (extension === 'pdf') return Buffer.from(buffer);
  if (!OFFICE_EXTENSIONS.has(extension)) {
    throw httpError(400, `${fileName || 'File'} cannot be converted to PDF`);
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'occ-leadership-print-'));
  try {
    const safeName = printableFileName(fileName);
    const inputPath = path.join(tempDirectory, safeName);
    const profilePath = path.join(tempDirectory, 'libreoffice-profile');
    await writeFile(inputPath, buffer);
    try {
      await run(libreOfficeBin, [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--nofirststartwizard',
        `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
        '--convert-to',
        'pdf',
        '--outdir',
        tempDirectory,
        inputPath,
      ], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw httpError(503, 'PDF printing is not configured on the server');
      }
      throw httpError(502, `${fileName} could not be converted to PDF`);
    }
    const outputPath = path.join(tempDirectory, `${path.parse(safeName).name}.pdf`);
    return await readFile(outputPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
};

export const mergeLeadershipPrintPdfs = async ({ documents, convert = convertLeadershipFileToPdf }) => {
  const printable = Array.isArray(documents) ? documents : [];
  if (!printable.length) throw httpError(400, 'Select at least one printable file');
  const totalCopies = printable.reduce((sum, document) => sum + Math.max(1, Number(document?.copies) || 1), 0);
  if (totalCopies > 100) throw httpError(400, 'The print job is limited to 100 document copies');

  const output = await PDFDocument.create();
  for (const document of printable) {
    const pdfBuffer = await convert({ fileName: document.fileName, buffer: document.buffer });
    const source = await PDFDocument.load(pdfBuffer);
    const copies = Math.max(1, Math.min(99, Math.trunc(Number(document.copies) || 1)));
    for (let copy = 0; copy < copies; copy += 1) {
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
    }
  }
  return Buffer.from(await output.save());
};
